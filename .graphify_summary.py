import json
from pathlib import Path
d = json.loads(Path(".graphify_detect.json").read_text(encoding="utf-8-sig"))
print("total_files:", d.get("total_files"))
print("total_words:", d.get("total_words"))
print("needs_graph:", d.get("needs_graph"))
print("warning:", d.get("warning"))
print("skipped_sensitive:", len(d.get("skipped_sensitive", [])))
files = d.get("files", {})
for k, v in files.items():
    print(f"  {k}: {len(v)} files")
