import json
from graphify.detect import detect
from pathlib import Path

result = detect(Path("implementation_plan.md"))
print(json.dumps(result))
