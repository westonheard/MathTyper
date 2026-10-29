use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

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
        .invoke_handler(tauri::generate_handler![write_file, read_file, unique_path, rename_file, compile_pdf, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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

}
