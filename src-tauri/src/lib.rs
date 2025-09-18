use exif::Reader;
use serde::Serialize;
use std::{fs::File, io::BufReader};

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
    let exif = Reader::new()
        .read_from_container(&mut reader)
        .map_err(|error| error.to_string())?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_exif])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
