"""
Platform Mapping Configuration

Defines how VMS local data maps to Bharatlytics Platform API
when running in 'connected' mode.
"""

PLATFORM_MAPPING = {
    # Employees: Maps to Platform actors collection
    'employees': {
        'source': '/bharatlytics/v1/actors',
        'params': {'companyId': '{company_id}'},
        'filter': {'actorType': 'employee'},
        'fieldMap': {
            '_id': '_id',
            'employeeId': 'attributes.employeeId',
            'employeeName': 'attributes.employeeName',
            'email': 'attributes.email',
            'phone': 'attributes.phone',
            'department': 'attributes.department',
            'designation': 'attributes.designation'
        }
    },
    
    # Entities: Maps to Platform entities (for entry points, zones)
    'entities': {
        'source': '/bharatlytics/v1/entities',
        'params': {'companyId': '{company_id}'},
        'filter': {'type': ['gate', 'reception', 'building', 'zone']},
        'fieldMap': {
            '_id': '_id',
            'entityId': '_id',
            'name': 'name',
            'type': 'type',
            'metadata': 'metadata'
        }
    },
    
    # Company info
    'company': {
        'source': '/bharatlytics/v1/companies/{company_id}',
        'fieldMap': {
            '_id': '_id',
            'companyName': 'companyName',
            'logo': 'logo',
            'address': 'address'
        }
    }
}
