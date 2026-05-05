import json
from graphify.cache import check_semantic_cache
from pathlib import Path

detect = json.loads(Path(".graphify_detect.json").read_text(encoding="utf-8-sig"))
all_files = [f for files in detect["files"].values() for f in files]

cached_nodes, cached_edges, cached_hyperedges, uncached = check_semantic_cache(all_files)

print(f"Total files: {len(all_files)}")
print(f"Cache hits: {len(all_files)-len(uncached)}")
print(f"Need extraction: {len(uncached)}")
print(f"Cached nodes: {len(cached_nodes)}, edges: {len(cached_edges)}, hyperedges: {len(cached_hyperedges)}")

if cached_nodes or cached_edges or cached_hyperedges:
    Path(".graphify_cached.json").write_text(json.dumps({"nodes": cached_nodes, "edges": cached_edges, "hyperedges": cached_hyperedges}), encoding="utf-8")
Path(".graphify_uncached.txt").write_text("\n".join(uncached), encoding="utf-8")
