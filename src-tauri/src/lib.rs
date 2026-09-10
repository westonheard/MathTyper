use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String>{
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String>{
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

fn pdflatex() -> PathBuf{
    //apps started from Finder don't get the shell PATH, so check the usual install locations
    for p in [
        "/Library/TeX/texbin/pdflatex", //MacTeX
        "/opt/homebrew/bin/pdflatex",   //Homebrew (Apple Silicon)
        "/usr/local/bin/pdflatex",      //Homebrew (Intel) or installed by hand
    ]{
        let path = PathBuf::from(p);
        if path.exists(){
            return path;
        }
    }
    PathBuf::from("pdflatex")
}

#[tauri::command]
async fn compile_pdf(latex: String) -> Result<String, String>{
    //own folder per run so two compiles never clobber each other
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("mathtyper-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("main.tex"), latex).map_err(|e| e.to_string())?;

    let out = Command::new(pdflatex())
        .args(["-interaction=nonstopmode", "-halt-on-error", "main.tex"])
        .current_dir(&dir)
        .output()
        .map_err(|e| format!("could not run pdflatex ({e}), is MacTeX installed?"))?;

    if !out.status.success(){
        //the reason is at the end of the log
        let log = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = log.lines().collect();
        return Err(lines[lines.len().saturating_sub(30)..].join("\n"));
    }

    let pdf = dir.join("main.pdf");
    Command::new("open").arg(&pdf).spawn().map_err(|e| e.to_string())?;
    Ok(pdf.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![write_file, read_file, compile_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
