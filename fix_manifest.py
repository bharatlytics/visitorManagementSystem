import json
import sys

# Mocking the schema from app/platform/api/manifest_schema.py
DATA_CONTRACT_SCHEMA = {
    "type": "object",
    "description": "Declares data consumption and production for bidirectional data exchange",
    "properties": {
        "consumes": {"type": "object"},
        "produces": {"type": "object"}
    }
}

MANIFEST_SCHEMA = {
    "type": "object",
    "required": ["id", "name", "version", "description", "developer", "capabilities"],
    "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9-]+$"},
        "name": {"type": "string"},
        "version": {"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$"},
        "description": {"type": "string"},
        "developer": {
            "type": "object",
            "required": ["name", "email"],
            "properties": {
                "name": {"type": "string"},
                "email": {"type": "string", "format": "email"},
                "website": {"type": "string", "format": "uri"}
            }
        },
        "capabilities": {"type": "object"},
        "dataContract": DATA_CONTRACT_SCHEMA
    }
}

def validate(manifest):
    try:
        from jsonschema import validate
        validate(instance=manifest, schema=MANIFEST_SCHEMA)
        print("✅ Manifest is VALID")
        return True
    except ImportError:
        print("⚠️ jsonschema not installed, checking required fields manually")
        required = ["id", "name", "version", "description", "developer", "capabilities"]
        missing = [k for k in required if k not in manifest]
        if missing:
            print(f"❌ Missing required fields: {missing}")
            return False
        return True
    except Exception as e:
        print(f"❌ Validation Error: {e}")
        return False

def fix_manifest(path):
    with open(path, 'r') as f:
        data = json.load(f)

    print("--- Original Validation ---")
    validate(data)

    # Fix: Flatten 'app' object
    if 'app' in data:
        print("\nFixing: Moving 'app' fields to top level...")
        app_data = data.pop('app')
        for k, v in app_data.items():
            if k not in data:
                data[k] = v
    
    # Fix: ID pattern (no underscores)
    if 'id' in data and '_' in data['id']:
        print(f"Fixing: Replacing underscores in ID '{data['id']}'...")
        data['id'] = data['id'].replace('_', '-')

    
    # Fix: Capabilities must be an object
    if 'capabilities' in data and isinstance(data['capabilities'], list):
        print("Fixing: Converting 'capabilities' list to object...")
        # Move list to 'features' or just ignore if not supported in schema
        # Schema requires capabilities to be an object
        data['capabilities'] = {
            "provides": {},
            "consumes": {}
        }
    elif 'capabilities' not in data:
        print("Fixing: Adding empty 'capabilities' object...")
        data['capabilities'] = {
            "provides": {},
            "consumes": {}
        }

    print("\n--- Fixed Validation ---")
    if validate(data):
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"\n✅ Saved fixed manifest to {path}")

if __name__ == "__main__":
    print("=== Fixing VMS Manifest ===")
    fix_manifest("c:\\Users\\sahil\\OneDrive\\Documents\\GitHub\\visitorManagementSystem\\manifest.json")
    print("\n=== Fixing People Tracking Manifest ===")
    fix_manifest("c:\\Users\\sahil\\OneDrive\\Documents\\GitHub\\peopleTracking\\manifest.json")

