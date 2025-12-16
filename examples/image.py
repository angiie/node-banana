import json, base64
from pathlib import Path

root = Path('.')
out_dir = root / 'contact-sheet-images'
out_dir.mkdir(exist_ok=True)

files = [
    'contact-sheet-tim.json',
    'contact-sheet-jpow.json',
    'contact-sheet-bills-supra.json',
]

def save_data_url(data_url: str, out_base: Path):
    header, b64 = data_url.split(',', 1)
    mime = header.split(';', 1)[0].split(':', 1)[-1]
    ext = mime.split('/')[-1] or 'jpg'
    out_path = out_base.with_suffix('.' + ext)
    raw = base64.b64decode(b64)
    out_path.write_bytes(raw)
    print(f"wrote {out_path} ({len(raw)} bytes)")

for fname in files:
    path = root / fname
    with path.open('r', encoding='utf-8') as f:
        data = json.load(f)

    stem = path.stem

    for node in data.get('nodes', []):
        node_type = node.get('type')
        nid = node.get('id')
        data_obj = node.get('data', {}) or {}

        if node_type == 'nanoBanana':
            img = data_obj.get('outputImage')
            if not isinstance(img, str) or ',' not in img:
                continue
            base = out_dir / f"{stem}-{nid}-output"
            try:
                save_data_url(img, base)
            except Exception as e:
                print(f"skip {stem}-{nid} output: {e}")

        elif node_type == 'imageInput':
            img = data_obj.get('image')
            if not isinstance(img, str) or ',' not in img:
                continue
            filename = data_obj.get('filename') or f"{stem}-{nid}-input"
            filename = Path(filename).name
            name_base = Path(filename).stem
            base = out_dir / f"{stem}-{nid}-{name_base}"
            try:
                save_data_url(img, base)
            except Exception as e:
                print(f"skip {stem}-{nid} imageInput: {e}")
