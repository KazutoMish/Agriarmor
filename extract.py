import pymupdf, pathlib, json
root=pathlib.Path('C:/Users/quiro/OneDrive/html')
assets=root/'assets'; assets.mkdir(exist_ok=True)
for name,filename in [('content','AgriArmor_ContentDraft.pdf'),('brand','Copy of AgriArmor (1).pdf')]:
 doc=pymupdf.open('C:/Users/quiro/Downloads/'+filename)
 text=[]
 for i,page in enumerate(doc):
  text.append(f'\n--- PAGE {i+1} ---\n'+page.get_text())
  if name=='brand':
   page.get_pixmap(matrix=pymupdf.Matrix(.6,.6)).save(str(assets/f'page-{i+1}.png'))
   for j,img in enumerate(page.get_images(full=True)):
    data=doc.extract_image(img[0])
    if data['width']>200 and data['height']>200:
     (assets/f'photo-{i+1}-{j}.{data["ext"]}').write_bytes(data['image'])
 (root/'.tools'/f'{name}.txt').write_text(''.join(text),encoding='utf-8')
 print(name, len(doc),'pages')
