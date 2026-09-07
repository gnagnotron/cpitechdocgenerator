from __future__ import annotations

import io
import json
import tempfile
import zipfile
from pathlib import Path

from flask import Flask, render_template_string, request, send_file
from werkzeug.utils import secure_filename

import scpi_iflow_doc_generator as generator

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

PAGE = """<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SAP CPI iFlow Documentation Generator</title>
  <style>
    :root { --ink:#17324d; --accent:#007f86; --canvas:#eef3f5; --panel:#fff; --line:#cbd8dc; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--canvas); color:var(--ink); font:16px Georgia, serif; }
    main { width:min(760px, calc(100% - 32px)); margin:9vh auto; }
    header { border-bottom:4px solid var(--accent); padding-bottom:22px; }
    h1 { font-size:clamp(2rem, 5vw, 3.4rem); margin:0; line-height:1.05; font-weight:normal; }
    .eyebrow { color:var(--accent); font:700 12px "Courier New", monospace; letter-spacing:.12em; text-transform:uppercase; margin-bottom:13px; }
    .lead { font-size:1.1rem; line-height:1.55; max-width:60ch; margin:20px 0 0; }
    form { margin-top:32px; padding:28px; background:var(--panel); border:1px solid var(--line); box-shadow:8px 8px 0 #d9e7e8; }
    label { display:block; font:700 14px "Courier New", monospace; text-transform:uppercase; letter-spacing:.06em; }
    input[type=file] { width:100%; margin-top:12px; padding:18px; border:1px dashed var(--accent); background:#f6fbfb; font:15px Georgia, serif; }
    button { margin-top:20px; border:0; background:var(--accent); color:#fff; padding:13px 20px; font:700 14px "Courier New", monospace; cursor:pointer; }
    button:hover { background:#00676d; }
    .note, .error { margin-top:22px; padding:14px 16px; border-left:4px solid var(--accent); background:#e8f4f4; line-height:1.45; }
    .error { border-color:#a83232; background:#fff0f0; color:#7b2020; }
    footer { margin-top:32px; color:#4a6070; font-size:.9rem; }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">SAP Cloud Integration</div>
      <h1>iFlow Documentation Generator</h1>
      <p class="lead">Carica uno o piu export ZIP di iFlow SAP CPI. Per ogni package verranno generati il documento Word e il modello JSON.</p>
    </header>
    <form method="post" action="/generate" enctype="multipart/form-data">
      <label for="files">ZIP iFlow</label>
      <input id="files" name="files" type="file" accept=".zip,application/zip" multiple required>
      <div id="selected-files" class="note">Nessun ZIP selezionato.</div>
      <button type="submit">Genera documentazione</button>
    </form>
    {% if error %}<div class="error">{{ error }}</div>{% endif %}
    <div class="note">L'output scaricato contiene <strong>docs/*.docx</strong> e <strong>json/*_parsed.json</strong>, prodotti dalla stessa logica del generatore Python.</div>
    <footer>Nessun servizio AI o configurazione API e richiesta.</footer>
  </main>
  <script>
    const input = document.getElementById("files");
    const selectedFiles = new Map();
    const selectedFilesLabel = document.getElementById("selected-files");

    input.addEventListener("change", () => {
      for (const file of input.files) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        selectedFiles.set(key, file);
      }

      const dataTransfer = new DataTransfer();
      for (const file of selectedFiles.values()) {
        dataTransfer.items.add(file);
      }
      input.files = dataTransfer.files;
      selectedFilesLabel.textContent = selectedFiles.size === 0
        ? "Nessun ZIP selezionato."
        : `${selectedFiles.size} ZIP selezionati: ${Array.from(selectedFiles.values()).map((file) => file.name).join(", ")}`;
    });
  </script>
</body>
</html>"""


@app.get("/")
def index():
    return render_template_string(PAGE, error=None)


@app.post("/generate")
def generate():
    uploaded_files = [
        uploaded
        for uploaded in request.files.getlist("files")
        if uploaded.filename
    ]
    if not uploaded_files:
        uploaded = request.files.get("file")
        if uploaded is not None and uploaded.filename:
            uploaded_files = [uploaded]

    if not uploaded_files:
        return render_template_string(PAGE, error="Seleziona un file ZIP iFlow."), 400

    if any(not uploaded.filename.lower().endswith(".zip") for uploaded in uploaded_files):
        return render_template_string(PAGE, error="Il file deve avere estensione .zip."), 400

    with tempfile.TemporaryDirectory(prefix="cpi-doc-") as work_dir:
        work_path = Path(work_dir)
        archive_data = io.BytesIO()

        try:
            with zipfile.ZipFile(archive_data, "w", zipfile.ZIP_DEFLATED) as archive:
                for index, uploaded in enumerate(uploaded_files, 1):
                    file_name = secure_filename(uploaded.filename)
                    input_zip = work_path / f"{index:02d}-{file_name}"
                    uploaded.save(input_zip)
                    model = generator.parse_iflow_zip(input_zip)
                    artifact_name = generator.safe_filename(
                        model["iflow"]["bundle_name"]
                        or model["iflow"]["artifact_id"]
                        or input_zip.stem
                    )
                    output_dir = work_path / f"{index:02d}-{Path(file_name).stem}"
                    json_path = output_dir / "json" / f"{artifact_name}_parsed.json"
                    docx_path = output_dir / "docs" / f"{artifact_name}.docx"
                    json_path.parent.mkdir(parents=True, exist_ok=True)
                    docx_path.parent.mkdir(parents=True, exist_ok=True)
                    json_path.write_text(
                        json.dumps(model, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    generator.generate_docx(model, docx_path)
                    archive.write(
                        docx_path,
                        arcname=f"{output_dir.name}/docs/{docx_path.name}",
                    )
                    archive.write(
                        json_path,
                        arcname=f"{output_dir.name}/json/{json_path.name}",
                    )
        except (OSError, ValueError, zipfile.BadZipFile, generator.ET.ParseError, RuntimeError) as error:
            return render_template_string(PAGE, error=f"Generazione non riuscita: {error}"), 422

        archive_data.seek(0)

    download_name = (
        f"{Path(secure_filename(uploaded_files[0].filename)).stem}_documentation.zip"
        if len(uploaded_files) == 1
        else "iflow-batch-documentation.zip"
    )
    return send_file(archive_data, as_attachment=True, download_name=download_name, mimetype="application/zip")


@app.errorhandler(413)
def file_too_large(_error):
    return render_template_string(PAGE, error="Il file supera il limite di 50 MB."), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
