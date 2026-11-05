use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

//a document the OS asked the app to open (double-click, "Open with"), kept until the window asks for it
struct OpenedFile(Mutex<Option<String>>);

#[tauri::command]
fn take_opened_file(state: tauri::State<OpenedFile>) -> Option<String>{
    state.0.lock().unwrap().take()
}

//the file commands are async so they run off the main thread, a slow disk can't freeze the window

#[tauri::command]
async fn write_file(path: String, contents: String) -> Result<(), String>{
    let p = Path::new(&path);
    if let Some(parent) = p.parent(){
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    //temp + rename so a crash mid save can never truncate the only copy
    let mut tmp = p.as_os_str().to_owned();
    tmp.push(".tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    //has to be on disk before the rename, or a power cut can leave an empty file under the real name
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, p).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String>{
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

//first free name in dir: "base.ext", then "base 2.ext" and so on
#[tauri::command]
async fn unique_path(dir: String, base: String, ext: String) -> String{
    let dir = Path::new(&dir);
    let mut p = dir.join(format!("{base}{ext}"));
    let mut n = 2;
    while p.exists(){
        p = dir.join(format!("{base} {n}{ext}"));
        n += 1;
    }
    p.to_string_lossy().into_owned()
}

#[tauri::command]
async fn rename_file(from: String, to: String) -> Result<(), String>{
    //if the user deleted the old file there is nothing to move, the next write creates the new one
    if !Path::new(&from).exists(){
        return Ok(());
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle){
    app.exit(0);
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

fn compile(dir: &Path, latex: &str) -> Result<PathBuf, String>{
    fs::write(dir.join("main.tex"), latex).map_err(|e| e.to_string())?;
    let out = Command::new(pdflatex())
        .args(["-interaction=nonstopmode", "-halt-on-error", "main.tex"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("could not run pdflatex ({e}), is MacTeX installed?"))?;

    if !out.status.success(){
        //the reason is at the end of the log
        let log = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = log.lines().collect();
        return Err(lines[lines.len().saturating_sub(30)..].join("\n"));
    }
    Ok(dir.join("main.pdf"))
}

#[tauri::command]
async fn export_pdf(latex: String, path: String) -> Result<(), String>{
    //own folder per run so two exports never clobber each other
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("mathtyper-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let result = compile(&dir, &latex)
        .and_then(|pdf| fs::copy(pdf, &path).map(|_| ()).map_err(|e| e.to_string()));
    //only the PDF is kept, the .aux and .log files used to pile up in the temp folder
    let _ = fs::remove_dir_all(&dir);
    result?;

    //the PDF is saved either way, not having a viewer is not an export failure
    let _ = Command::new("open").arg(&path).spawn();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(){
    //Windows and Linux pass a double-clicked document as the first argument
    let from_args = std::env::args().nth(1).filter(|a| !a.starts_with('-'));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedFile(Mutex::new(from_args)))
        .invoke_handler(tauri::generate_handler![
            take_opened_file,
            write_file,
            read_file,
            unique_path,
            rename_file,
            quit_app,
            export_pdf
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            //macOS sends it as an event instead, also while the app is already running
            //ponytail: on Windows and Linux a second double-click starts a second copy of the app,
            //tauri-plugin-single-instance if one window should take them all
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event{
                use tauri::{Emitter, Manager};
                if let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()){
                    *app.state::<OpenedFile>().0.lock().unwrap() = Some(path.to_string_lossy().into_owned());
                    let _ = app.emit("open-file", ());
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

//cargo test, runs the file commands against a real temp folder
#[cfg(test)]
mod tests{
    use super::*;
    use tauri::async_runtime::block_on;

    #[test]
    fn save_name_and_rename(){
        let dir = std::env::temp_dir().join(format!("mathtyper-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let d = dir.to_string_lossy().into_owned();

        //the folder doesn't exist yet, write_file has to create it
        let first = block_on(unique_path(d.clone(), "Notes".into(), ".mtd".into()));
        assert!(first.ends_with("Notes.mtd"));
        block_on(write_file(first.clone(), "one".into())).unwrap();
        assert_eq!(block_on(read_file(first.clone())).unwrap(), "one");
        assert!(!Path::new(&format!("{first}.tmp")).exists());

        //taken names get a number, and saving again replaces the file
        let second = block_on(unique_path(d.clone(), "Notes".into(), ".mtd".into()));
        assert!(second.ends_with("Notes 2.mtd"));
        block_on(write_file(first.clone(), "two".into())).unwrap();
        assert_eq!(block_on(read_file(first.clone())).unwrap(), "two");

        block_on(rename_file(first.clone(), second.clone())).unwrap();
        assert!(!Path::new(&first).exists());
        assert_eq!(block_on(read_file(second.clone())).unwrap(), "two");
        //the old file being gone already is not an error
        block_on(rename_file(first, second)).unwrap();

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn compiles_a_pdf(){
        //needs a TeX install, so it only really runs on a machine that has one
        if Command::new(pdflatex()).arg("-version").output().is_err(){
            return;
        }
        let dir = std::env::temp_dir().join(format!("mathtyper-test-pdf-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let pdf = compile(&dir, "\\documentclass{article}\\begin{document}$x^2$\\end{document}").unwrap();
        assert!(pdf.exists());
        //a broken document comes back as the end of the log, not as a PDF
        assert!(compile(&dir, "\\documentclass{article}\\begin{document}\\nope\\end{document}").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
