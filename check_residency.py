from app.db import companies_collection

company_id = '6827296ab6e06b08639107c4'

# Try both string and ObjectId
company = companies_collection.find_one({'_id': company_id})

if not company:
    from bson import ObjectId
    try:
        company = companies_collection.find_one({'_id': ObjectId(company_id)})
    except:
        pass

if company:
    residency_config = company.get('dataResidency', {})
    visitor_config = residency_config.get('visitor', {})
    visitor_mode = visitor_config.get('mode', 'app')
    
    print(f"✅ Company found: {company.get('companyName')}")
    print(f"   Company ID: {company_id}")
    print(f"\nVisitor Data Residency:")
    print(f"   Mode: {visitor_mode}")
    print(f"   Full visitor config: {visitor_config}")
    
    if visitor_mode == 'platform':
        print("\n✅ Residency is PLATFORM")
        print("   VMS should proxy to Platform for embeddings")
        print("   Embedding 6881fcfbb80d7fe19da787cf should be fetched from Platform")
    else:
        print("\n⚠️  Residency is APP (default)")
        print("   VMS will look in local GridFS")
        print("   But embedding is NOT in VMS - it's on Platform!")
        print("   You need to set visitor residency to 'platform'")
else:
    print(f"❌ Company {company_id} not found in database")
    print("   Checking all companies...")
    all_companies = list(companies_collection.find({}, {'_id': 1, 'companyName': 1}))
    for c in all_companies[:5]:
        print(f"   - {c.get('companyName')}: {c.get('_id')}")
