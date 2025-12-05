"""
VMS Document Models
Builders for visitor and visit documents
"""
from bson import ObjectId
from app.utils import get_current_utc


def build_visitor_doc(data, image_dict=None, embeddings_dict=None, document_dict=None):
    """
    Build a visitor document for MongoDB insertion
    
    Args:
        data: dict with visitor data (companyId, visitorName, phone, etc.)
        image_dict: dict of face images {position: GridFS ID}
        embeddings_dict: dict of embeddings {model: embedding_entry}
        document_dict: dict of ID documents {doc_type: GridFS ID}
    
    Returns:
        Complete visitor document ready for insertion
    """
    image_dict = image_dict or {}
    embeddings_dict = embeddings_dict or {}
    document_dict = document_dict or {}
    
    now = get_current_utc()
    
    visitor_doc = {
        'companyId': ObjectId(data['companyId']),
        'visitorName': data['visitorName'],
        'phone': data['phone'],
        'email': data.get('email'),
        'organization': data.get('organization'),
        'visitorType': data.get('visitorType', 'general'),
        'idType': data.get('idType'),
        'idNumber': data.get('idNumber'),
        'purpose': data.get('purpose'),
        'hostEmployeeId': ObjectId(data['hostEmployeeId']) if data.get('hostEmployeeId') else None,
        'status': data.get('status', 'active'),
        'blacklisted': data.get('blacklisted', 'false').lower() == 'true' if isinstance(data.get('blacklisted'), str) else bool(data.get('blacklisted', False)),
        'blacklistReason': data.get('blacklistReason'),
        'visitorImages': image_dict,
        'visitorEmbeddings': embeddings_dict,
        'idDocuments': document_dict,
        'visits': [],
        'createdAt': now,
        'lastUpdated': now
    }
    
    return visitor_doc


def build_visit_doc(visitor_id, company_id, host_employee_id, purpose, 
                    expected_arrival, expected_departure, approved=False,
                    hostEmployeeName=None, hostEmployeeCode=None,
                    visitorName=None, visitorMobile=None,
                    vehicleNumber=None, numberOfPersons=1, belongings=None):
    """
    Build a visit document for MongoDB insertion
    
    Args:
        visitor_id: ObjectId or list of ObjectIds for group visits
        company_id: ObjectId of the company
        host_employee_id: ObjectId of the host employee
        purpose: Visit purpose string
        expected_arrival: datetime of expected arrival
        expected_departure: datetime of expected departure
        approved: Whether the visit is pre-approved
        hostEmployeeName: Name of the host employee
        hostEmployeeCode: Employee ID/code of the host
        visitorName: Name of the primary visitor
        visitorMobile: Mobile number of the primary visitor
        vehicleNumber: Optional vehicle number
        numberOfPersons: Number of persons in the visit
        belongings: List of belongings
    
    Returns:
        Complete visit document ready for insertion
    """
    belongings = belongings or []
    now = get_current_utc()
    
    visit_doc = {
        'visitorId': visitor_id,
        'companyId': company_id,
        'hostEmployeeId': host_employee_id,
        'hostEmployeeName': hostEmployeeName,
        'hostEmployeeCode': hostEmployeeCode,
        'visitorName': visitorName,
        'visitorMobile': visitorMobile,
        'purpose': purpose,
        'expectedArrival': expected_arrival,
        'expectedDeparture': expected_departure,
        'actualArrival': None,
        'actualDeparture': None,
        'status': 'scheduled',
        'approved': approved,
        'checkInMethod': None,
        'vehicleNumber': vehicleNumber,
        'numberOfPersons': numberOfPersons,
        'belongings': belongings,
        'accessAreas': [],
        'visitType': 'single',
        'createdAt': now,
        'lastUpdated': now
    }
    
    return visit_doc
