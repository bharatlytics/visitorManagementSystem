from dotenv import load_dotenv
import os

load_dotenv()
uri = os.getenv('VMS_MONGODB_URI')
print(f"VMS_MONGODB_URI: {uri}")
