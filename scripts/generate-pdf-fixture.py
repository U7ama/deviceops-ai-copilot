"""Original synthetic fixture. Run with pypdf 5.9.0; writes a synthetic PDF to stdout."""
import sys, io
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
writer=PdfWriter()
for number in range(1,31):
    page=writer.add_blank_page(width=612,height=792)
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
    lines=['SYNTHETIC TRAINING MANUAL - MIT',f'Original page {number} of 30']
    if number==30:
        lines+=['Campus switch: optical attenuation and temperature drift','Inspect received optical power against the transceiver specification.','Declining power is evidence; dirty fiber remains a hypothesis.','PORT 24 / TRUNK-2: confirm technician mapping before action.']
    else:lines+=['General synthetic equipment reference.','No operational instructions on this page.']
    content='BT /F1 14 Tf 50 740 Td '
    content+=' '.join(f'({line}) Tj 0 -26 Td' for line in lines)+' ET\n'
    if number==30:content+='0.1 0.3 0.6 RG 2 w 70 380 180 90 re S 350 380 180 90 re S 250 425 m 350 425 l S BT /F1 16 Tf 92 420 Td (SWITCH PORT 24) Tj 268 0 Td (TRUNK-2) Tj ET'
    stream=DecodedStreamObject();stream.set_data(content.encode());page[NameObject('/Contents')]=writer._add_object(stream)
writer.add_metadata({'/Title':'Original synthetic optical manual','/Author':'DeviceOps demo fixtures'})
output=io.BytesIO(); writer.write(output); sys.stdout.buffer.write(output.getvalue())
