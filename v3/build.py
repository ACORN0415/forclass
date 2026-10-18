import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
r=lambda f: open(f,encoding='utf-8').read()
body=r('p1_head.html')+"\n"+r('p2_engine_input.js')+"\n"+r('p3_ui.js')+"\n"+r('p4_render.js')+"\n"+r('p5_result.js')+"\n"+r('p6_infinite.js')+"</script>\n"
open('../arena.html','w',encoding='utf-8').write('<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'+body.replace('</style>\n','</style>\n</head><body>\n',1)+'</body></html>\n')
open('arena_artifact.html','w',encoding='utf-8').write(body)
print('built')
