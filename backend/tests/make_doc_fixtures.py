"""Builds SPECIMEN KYC documents (fake people, fake numbers) for testing the
document checker. Every page is stamped "SPECIMEN - TEST DATA".

  genuine_*   consistent numbers, plain generator, single save
  tampered_*  one or more realistic forgery traces

Run:  python3 make_doc_fixtures.py     (needs: reportlab, pypdf, pillow)
"""
import os, io, datetime
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from pypdf import PdfWriter
from PIL import Image, PngImagePlugin

OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'docs')
os.makedirs(OUT, exist_ok=True)

# Verhoeff helper (same tables as the backend) so Aadhaar specimens are valid/invalid on purpose.
D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
INV = [0,4,3,2,1,5,6,7,8,9]
def check_digit(n):
    c = 0
    for i, d in enumerate(reversed(n)):
        c = D[c][P[(i + 1) % 8][int(d)]]
    return str(INV[c])
GOOD_AADHAAR = '4821 7365 904' + check_digit('48217365904')
BAD_AADHAAR = GOOD_AADHAAR[:-1] + str((int(GOOD_AADHAAR[-1]) + 3) % 10)

def make(name, draw, producer=None, creator=None):
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=A4, pageCompression=0)
    if producer: c.setProducer(producer)
    if creator: c.setCreator(creator)
    c.setTitle('Specimen')
    c.setFont('Helvetica-Bold', 9)
    c.drawString(40, 815, 'SPECIMEN - TEST DATA - NOT A REAL DOCUMENT')
    draw(c)
    c.showPage(); c.save()
    return path

def lines(c, y, rows, size=11, gap=18, x=60):
    c.setFont('Helvetica', size)
    for r in rows:
        c.drawString(x, y, r); y -= gap
    return y

def salary(gross_ok=True, net_ok=True):
    def draw(c):
        c.setFont('Helvetica-Bold', 16); c.drawString(60, 770, 'Northwind Tech Pvt Ltd')
        lines(c, 745, ['Salary Slip for March 2026', 'Employee: Rahul Sharma    PAN: ABCPS1234D', ''])
        basic, hra, special, conv = 40000, 16000, 12000, 2000
        gross = basic + hra + special + conv + (0 if gross_ok else 9000)   # inflated gross when tampered
        pf = 4800; tax = 5200; prof = 200
        ded = pf + tax + prof
        net = gross - ded if net_ok else gross - ded + 25000
        rows = [f'Basic Salary            {basic:,.2f}', f'HRA                     {hra:,.2f}',
                f'Special Allowance       {special:,.2f}', f'Conveyance Allowance     {conv:,.2f}',
                f'Gross Earnings          {gross:,.2f}', '',
                f'Provident Fund          {pf:,.2f}', f'Income Tax              {tax:,.2f}', f'Professional Tax        {prof:,.2f}',
                f'Total Deductions        {ded:,.2f}', '', f'Net Pay                 {net:,.2f}']
        lines(c, 690, rows)
    return draw

def statement(tamper=False):
    def draw(c):
        c.setFont('Helvetica-Bold', 16); c.drawString(60, 770, 'Northwind Bank - Account Statement')
        lines(c, 745, ['Account: XXXXXX4821   IFSC: HDFC0001234   PAN: ABCPS1234D', 'Opening Balance 50,000.00', '',
                       'Date        Narration                Debit      Credit     Balance'])
        bal = 50000.0
        tx = [('01/04/2026', 'UPI/Grocery', 1250.00, 0), ('03/04/2026', 'Salary Credit', 0, 62000.00),
              ('05/04/2026', 'ATM Withdrawal', 5000.00, 0), ('09/04/2026', 'Electricity Bill', 2380.50, 0),
              ('12/04/2026', 'UPI/Refund', 0, 799.00), ('18/04/2026', 'Rent Transfer', 18000.00, 0)]
        y = 690
        for i, (d, n, db, cr) in enumerate(tx):
            bal = bal - db + cr
            shown_cr = cr
            if tamper and i == 4:
                shown_cr = 79900.00   # edited amount, balance left untouched
            c.setFont('Helvetica', 10)
            c.drawString(60, y, f'{d}  {n:<22} {db:>9,.2f}  {shown_cr:>9,.2f}  {bal:>10,.2f}')
            y -= 17
        lines(c, y - 10, [f'Closing Balance {bal:,.2f}'])
    return draw

def aadhaar(number):
    def draw(c):
        c.setFont('Helvetica-Bold', 15); c.drawString(60, 770, 'Government of India - Aadhaar (Unique Identification Authority of India)')
        lines(c, 735, ['Name: Rahul Sharma', 'DOB: 14/08/1996', 'Gender: Male', '', f'Aadhaar No: {number}', '', 'Mera Aadhaar, Meri Pehchaan'], size=13, gap=22)
    return draw

def pan(number):
    def draw(c):
        c.setFont('Helvetica-Bold', 15); c.drawString(60, 770, 'INCOME TAX DEPARTMENT  -  GOVT. OF INDIA')
        lines(c, 735, ['Permanent Account Number Card', '', f'PAN: {number}', 'Name: RAHUL SHARMA', "Father's Name: SURESH SHARMA", 'DOB: 14/08/1996'], size=13, gap=22)
    return draw

def incremental(path, new_producer):
    """Re-save the way an editor does: append a second revision to the same file."""
    w = PdfWriter(path, incremental=True)
    w.add_metadata({'/Producer': new_producer, '/ModDate': 'D:20260420101500Z'})
    w.write(path)

# ---- Genuine ----
make('genuine_salary_slip.pdf', salary(), producer='ReportLab PDF Library', creator='Payroll System v4')
make('genuine_bank_statement.pdf', statement(), producer='iText 7.2.5', creator='Core Banking')
make('genuine_aadhaar.pdf', aadhaar(GOOD_AADHAAR), producer='UIDAI Print Service')
make('genuine_pan.pdf', pan('ABCPS1234D'), producer='NSDL e-PAN')

# ---- Tampered ----
make('tampered_salary_totals.pdf', salary(gross_ok=False, net_ok=False), producer='ReportLab PDF Library', creator='Payroll System v4')
make('tampered_salary_word.pdf', salary(net_ok=False), producer='Microsoft Word', creator='Microsoft Word')
p = make('tampered_bank_statement.pdf', statement(tamper=True), producer='iText 7.2.5', creator='Core Banking')
incremental(p, 'iLovePDF')
make('tampered_aadhaar_checksum.pdf', aadhaar(BAD_AADHAAR), producer='Canva')
make('tampered_pan_surname.pdf', pan('ABCPK1234D'), producer='ReportLab PDF Library')

# ---- Images (scanned / photographed copies) ----
img = Image.new('RGB', (1000, 630), (240, 235, 225))
buf = io.BytesIO(); img.save(buf, 'JPEG', exif=Image.Exif())
ex = Image.Exif(); ex[0x010F] = 'Xiaomi'; ex[0x0110] = 'Redmi Note 11'; ex[0x0131] = 'MIUI Camera'; ex[0x9003] = '2026:04:02 10:14:09'
img.save(os.path.join(OUT, 'genuine_aadhaar_photo.jpg'), 'JPEG', exif=ex)
meta = PngImagePlugin.PngInfo(); meta.add_text('Software', 'Adobe Photoshop 25.0 (Windows)')
img.save(os.path.join(OUT, 'tampered_aadhaar_photo.png'), 'PNG', pnginfo=meta)

print('Aadhaar specimens:', GOOD_AADHAAR, '(valid) /', BAD_AADHAAR, '(invalid)')
for f in sorted(os.listdir(OUT)): print(' ', f)
