"""
Badge API - Generate visitor badges with photos and QR codes
"""
from flask import Blueprint, send_file, jsonify
from bson import ObjectId
import io
import qrcode
from PIL import Image, ImageDraw, ImageFont
from datetime import datetime

from app.db import visit_collection, visitor_collection, companies_collection, visitor_image_fs

badge_bp = Blueprint('badge', __name__)


def get_font(size, bold=False):
    """Get font with fallback to default"""
    try:
        font_name = "arialbd.ttf" if bold else "arial.ttf"
        return ImageFont.truetype(font_name, size)
    except IOError:
        try:
            # Try common font paths
            if bold:
                return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
            return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
        except IOError:
            return ImageFont.load_default()


@badge_bp.route('/visits/<visit_id>/badge', methods=['GET'])
def get_badge(visit_id):
    """Generate a visitor badge image for a visit"""
    try:
        # Fetch visit
        visit = visit_collection.find_one({'_id': ObjectId(visit_id)})
        if not visit:
            return jsonify({'error': 'Visit not found'}), 404
            
        # Fetch visitor
        visitor = visitor_collection.find_one({'_id': visit['visitorId']})
        if not visitor:
            return jsonify({'error': 'Visitor not found'}), 404
            
        # Fetch company
        company = companies_collection.find_one({'_id': visit['companyId']})
        company_name = company.get('companyName', 'Visitor Badge') if company else 'Visitor Badge'
        
        # Badge dimensions (vertical ID card: 638x1011 px)
        width, height = 638, 1011
        background_color = (255, 255, 255)
        
        img = Image.new('RGB', (width, height), background_color)
        draw = ImageDraw.Draw(img)
        
        # Draw Header (Company Name)
        header_height = 150
        draw.rectangle([(0, 0), (width, header_height)], fill=(0, 51, 102))  # Dark Blue
        
        font_header = get_font(40, bold=True)
        draw.text((50, 50), company_name, fill=(255, 255, 255), font=font_header)

        # Draw Visitor Photo
        face_image_id = None
        if 'visitorImages' in visitor:
            face_image_id = visitor['visitorImages'].get('center')
        
        photo_y = header_height + 30
        photo_size = 300
        
        if face_image_id:
            try:
                grid_out = visitor_image_fs.get(ObjectId(face_image_id))
                photo_data = grid_out.read()
                photo = Image.open(io.BytesIO(photo_data))
                photo = photo.resize((photo_size, photo_size))
                img.paste(photo, ((width - photo_size) // 2, photo_y))
            except Exception as e:
                print(f"Error loading visitor image: {e}")
                # Draw placeholder
                draw.rectangle([((width - photo_size) // 2, photo_y), ((width + photo_size) // 2, photo_y + photo_size)], outline="black")
                draw.text(((width - 100) // 2, photo_y + 130), "No Photo", fill="black", font=get_font(20))
        else:
            # Draw placeholder
            draw.rectangle([((width - photo_size) // 2, photo_y), ((width + photo_size) // 2, photo_y + photo_size)], outline="black")
            draw.text(((width - 100) // 2, photo_y + 130), "No Photo", fill="black", font=get_font(20))

        # Draw Visitor Name
        name_y = photo_y + photo_size + 40
        font_name = get_font(50, bold=True)
        visitor_name = visitor.get('visitorName', 'Visitor')
        draw.text((50, name_y), visitor_name, fill=(0, 0, 0), font=font_name)

        # Draw Visitor Type / Role
        role_y = name_y + 70
        font_role = get_font(30)
        visitor_type = visitor.get('visitorType', 'Visitor').upper()
        draw.text((50, role_y), visitor_type, fill=(100, 100, 100), font=font_role)
        
        # Draw Host Name
        host_y = role_y + 60
        host_name = visit.get('hostEmployeeName', '')
        if host_name:
            draw.text((50, host_y), f"Host: {host_name}", fill=(0, 0, 0), font=get_font(30))

        # Draw Date
        date_y = host_y + 50
        visit_date = visit.get('expectedArrival')
        if isinstance(visit_date, datetime):
            date_str = visit_date.strftime('%Y-%m-%d')
        else:
            date_str = str(visit_date)[:10] if visit_date else 'N/A'
        draw.text((50, date_y), f"Date: {date_str}", fill=(0, 0, 0), font=get_font(30))

        # Generate QR Code
        qr = qrcode.QRCode(box_size=10, border=2)
        qr.add_data(str(visit_id))
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white")
        qr_size = 200
        qr_img = qr_img.resize((qr_size, qr_size))
        
        qr_y = height - qr_size - 30
        img.paste(qr_img, ((width - qr_size) // 2, qr_y))
        
        # Save to buffer
        img_io = io.BytesIO()
        img.save(img_io, 'PNG')
        img_io.seek(0)
        
        return send_file(img_io, mimetype='image/png')
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
