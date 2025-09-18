use exif::{Error as ExifError, Reader};
use flate2::read::ZlibDecoder;
use serde::Serialize;
use std::{
    fs::File,
    io::{Cursor, ErrorKind, Read},
};

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Serialize)]
pub struct ExifField {
    tag: String,
    ifd: String,
    value: String,
}

#[tauri::command]
fn read_exif(path: String) -> Result<Vec<ExifField>, String> {
    let mut file = File::open(&path).map_err(|error| error.to_string())?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)
        .map_err(|error| error.to_string())?;

    let mut fields: Vec<ExifField> = Vec::new();
    {
        let mut cursor = Cursor::new(&data[..]);
        match Reader::new().read_from_container(&mut cursor) {
            Ok(exif) => {
                fields.extend(exif.fields().map(|field| ExifField {
                    tag: field.tag.to_string(),
                    ifd: format!("{:?}", field.ifd_num),
                    value: field.display_value().with_unit(&exif).to_string(),
                }));
            }
            Err(ExifError::NotFound(_)) => {}
            Err(ExifError::InvalidFormat(message)) => {
                return Err(match message {
                    "Unknown image format" => {
                        "The selected file format is not supported.".to_string()
                    }
                    other => other.to_string(),
                });
            }
            Err(ExifError::Io(error)) => {
                return Err(match error.kind() {
                    ErrorKind::UnexpectedEof => {
                        "The selected file appears to be truncated or corrupted.".to_string()
                    }
                    _ => error.to_string(),
                });
            }
            Err(other) => return Err(other.to_string()),
        }
    }

    fields.extend(parse_png_text_chunks(&data));

    fields.sort_by(|a, b| match a.ifd.cmp(&b.ifd) {
        std::cmp::Ordering::Equal => a.tag.cmp(&b.tag),
        other => other,
    });

    Ok(fields)
}

fn parse_png_text_chunks(data: &[u8]) -> Vec<ExifField> {
    if data.len() < PNG_SIGNATURE.len() || data[..PNG_SIGNATURE.len()] != PNG_SIGNATURE {
        return Vec::new();
    }

    let mut offset = PNG_SIGNATURE.len();
    let mut fields = Vec::new();

    while offset + 8 <= data.len() {
        let length_bytes = &data[offset..offset + 4];
        let length =
            u32::from_be_bytes(length_bytes.try_into().expect("slice has 4 bytes")) as usize;
        offset += 4;

        if offset + 4 > data.len() {
            break;
        }
        let chunk_type = &data[offset..offset + 4];
        offset += 4;

        if offset + length > data.len() {
            break;
        }
        let chunk_data = &data[offset..offset + length];
        offset += length;

        if offset + 4 > data.len() {
            break;
        }
        offset += 4; // Skip CRC

        match chunk_type {
            b"tEXt" => parse_png_text_chunk(chunk_data, "PNG tEXt", &mut fields),
            b"zTXt" => parse_png_ztxt_chunk(chunk_data, &mut fields),
            b"iTXt" => parse_png_itxt_chunk(chunk_data, &mut fields),
            _ => {}
        }

        if chunk_type == b"IEND" {
            break;
        }
    }

    fields
}

fn parse_png_text_chunk(chunk_data: &[u8], ifd: &'static str, fields: &mut Vec<ExifField>) {
    if let Some(separator) = chunk_data.iter().position(|&byte| byte == 0) {
        if separator == 0 {
            return;
        }
        let keyword = &chunk_data[..separator];
        let text = &chunk_data[separator + 1..];
        let value = decode_latin1(text);
        add_png_text_field(fields, keyword, value, ifd);
    }
}

fn parse_png_ztxt_chunk(chunk_data: &[u8], fields: &mut Vec<ExifField>) {
    if let Some(separator) = chunk_data.iter().position(|&byte| byte == 0) {
        if separator + 1 >= chunk_data.len() {
            return;
        }
        let keyword = &chunk_data[..separator];
        let compression_method = chunk_data[separator + 1];
        if compression_method != 0 {
            return;
        }
        let mut decoder = ZlibDecoder::new(&chunk_data[separator + 2..]);
        let mut decoded = Vec::new();
        if decoder.read_to_end(&mut decoded).is_ok() {
            let value = decode_latin1(&decoded);
            add_png_text_field(fields, keyword, value, "PNG zTXt");
        }
    }
}

fn parse_png_itxt_chunk(chunk_data: &[u8], fields: &mut Vec<ExifField>) {
    let mut cursor = 0;
    let keyword_end = match chunk_data.iter().position(|&byte| byte == 0) {
        Some(pos) => pos,
        None => return,
    };
    if keyword_end == 0 {
        return;
    }
    let keyword = &chunk_data[..keyword_end];
    cursor = keyword_end + 1;

    if cursor + 2 > chunk_data.len() {
        return;
    }
    let compression_flag = chunk_data[cursor];
    let compression_method = chunk_data[cursor + 1];
    cursor += 2;

    let language_end = match chunk_data[cursor..].iter().position(|&byte| byte == 0) {
        Some(pos) => cursor + pos,
        None => return,
    };
    let language_tag = &chunk_data[cursor..language_end];
    cursor = language_end + 1;

    let translated_end = match chunk_data[cursor..].iter().position(|&byte| byte == 0) {
        Some(pos) => cursor + pos,
        None => return,
    };
    let translated_keyword = &chunk_data[cursor..translated_end];
    cursor = translated_end + 1;

    if cursor > chunk_data.len() {
        return;
    }
    let text_bytes = &chunk_data[cursor..];

    let text_data = if compression_flag == 1 {
        if compression_method != 0 {
            return;
        }
        let mut decoder = ZlibDecoder::new(text_bytes);
        let mut decoded = Vec::new();
        if decoder.read_to_end(&mut decoded).is_err() {
            return;
        }
        decoded
    } else {
        text_bytes.to_vec()
    };

    let mut value = String::from_utf8_lossy(&text_data).into_owned();
    if !language_tag.is_empty() {
        value.push_str(&format!(
            "\nLanguage tag: {}",
            String::from_utf8_lossy(language_tag)
        ));
    }
    if !translated_keyword.is_empty() {
        value.push_str(&format!(
            "\nTranslated keyword: {}",
            String::from_utf8_lossy(translated_keyword)
        ));
    }

    add_png_text_field(fields, keyword, value, "PNG iTXt");
}

fn add_png_text_field(
    fields: &mut Vec<ExifField>,
    keyword: &[u8],
    value: String,
    ifd: &'static str,
) {
    if keyword.is_empty() {
        return;
    }
    let tag = decode_latin1(keyword);
    fields.push(ExifField {
        tag,
        ifd: ifd.to_string(),
        value,
    });
}

fn decode_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| byte as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::ZlibEncoder, Compression};
    use std::io::Write;

    fn fixture_path(relative: &str) -> String {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(relative)
            .to_string_lossy()
            .into_owned()
    }

    fn build_png_with_text_chunks() -> Vec<u8> {
        fn png_chunk(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
            let mut chunk = Vec::new();
            chunk.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            chunk.extend_from_slice(kind);
            chunk.extend_from_slice(payload);
            chunk.extend_from_slice(&[0, 0, 0, 0]);
            chunk
        }

        let mut data = Vec::new();
        data.extend_from_slice(&PNG_SIGNATURE);

        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&1u32.to_be_bytes());
        ihdr.extend_from_slice(&1u32.to_be_bytes());
        ihdr.push(8);
        ihdr.push(2);
        ihdr.push(0);
        ihdr.push(0);
        ihdr.push(0);
        data.extend(png_chunk(b"IHDR", &ihdr));

        data.extend(png_chunk(b"tEXt", b"Software\0Test App"));

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(b"Compressed note").unwrap();
        let compressed = encoder.finish().unwrap();
        let mut ztxt_payload = Vec::new();
        ztxt_payload.extend_from_slice(b"Comment");
        ztxt_payload.push(0);
        ztxt_payload.push(0);
        ztxt_payload.extend_from_slice(&compressed);
        data.extend(png_chunk(b"zTXt", &ztxt_payload));

        let mut itxt_payload = Vec::new();
        itxt_payload.extend_from_slice(b"Description");
        itxt_payload.push(0);
        itxt_payload.push(0);
        itxt_payload.push(0);
        itxt_payload.extend_from_slice(b"en");
        itxt_payload.push(0);
        itxt_payload.extend_from_slice(b"Beschreibung");
        itxt_payload.push(0);
        itxt_payload.extend_from_slice(b"International text");
        data.extend(png_chunk(b"iTXt", &itxt_payload));

        data.extend(png_chunk(b"IEND", &[]));
        data
    }

    #[test]
    fn png_without_exif_returns_empty_result() {
        let fields = read_exif(fixture_path("app-logo.png"))
            .expect("PNG without metadata should return an empty result");
        assert!(fields.is_empty());
    }

    #[test]
    fn unsupported_format_returns_friendly_error() {
        let error = read_exif(fixture_path("README.md"))
            .expect_err("Non-image files should not produce EXIF data");
        assert_eq!(error, "The selected file format is not supported.");
    }

    #[test]
    fn png_text_chunks_are_exposed_as_metadata() {
        let png = build_png_with_text_chunks();
        let mut path = std::env::temp_dir();
        path.push(format!(
            "exif_viewer_png_text_{}_{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, &png).expect("should write PNG fixture");

        let fields = read_exif(path.to_string_lossy().into_owned())
            .expect("PNG text chunks should be parsed");

        std::fs::remove_file(&path).ok();

        assert!(!fields.is_empty());

        let software = fields
            .iter()
            .find(|field| field.ifd == "PNG tEXt" && field.tag == "Software")
            .expect("expected Software tEXt field");
        assert_eq!(software.value, "Test App");

        let comment = fields
            .iter()
            .find(|field| field.ifd == "PNG zTXt" && field.tag == "Comment")
            .expect("expected Comment zTXt field");
        assert_eq!(comment.value, "Compressed note");

        let description = fields
            .iter()
            .find(|field| field.ifd == "PNG iTXt" && field.tag == "Description")
            .expect("expected Description iTXt field");
        assert!(description.value.contains("International text"));
        assert!(description.value.contains("Language tag: en"));
        assert!(description
            .value
            .contains("Translated keyword: Beschreibung"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_exif])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
