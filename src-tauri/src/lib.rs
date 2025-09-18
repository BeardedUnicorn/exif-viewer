use exif::{Error as ExifError, Reader};
use serde::Serialize;
use std::{
    fs::File,
    io::{BufReader, ErrorKind},
};

#[derive(Serialize)]
pub struct ExifField {
    tag: String,
    ifd: String,
    value: String,
}

#[tauri::command]
fn read_exif(path: String) -> Result<Vec<ExifField>, String> {
    let file = File::open(&path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let exif = match Reader::new().read_from_container(&mut reader) {
        Ok(exif) => exif,
        Err(ExifError::NotFound(_)) => return Ok(Vec::new()),
        Err(ExifError::InvalidFormat(message)) => {
            return Err(match message {
                "Unknown image format" => "The selected file format is not supported.".to_string(),
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
    };

    let mut fields: Vec<ExifField> = exif
        .fields()
        .map(|field| ExifField {
            tag: field.tag.to_string(),
            ifd: format!("{:?}", field.ifd_num),
            value: field.display_value().with_unit(&exif).to_string(),
        })
        .collect();

    fields.sort_by(|a, b| match a.ifd.cmp(&b.ifd) {
        std::cmp::Ordering::Equal => a.tag.cmp(&b.tag),
        other => other,
    });

    Ok(fields)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path(relative: &str) -> String {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(relative)
            .to_string_lossy()
            .into_owned()
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
