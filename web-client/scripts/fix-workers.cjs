const fs = require('fs')
const path = require('path')

const files = [
  path.resolve(__dirname, '..', 'dist', 'threeWorker.js'),
  path.resolve(__dirname, '..', 'dist', 'mesherWasm.js'),
  path.resolve(__dirname, '..', 'dist', 'mesher.js'),
]

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log('[fix-workers] Not found, skipping:', path.basename(file))
    continue
  }

  let content = fs.readFileSync(file, 'utf8')

  // Pattern 1: global process declaration (add var)
  content = content.replace(
    /globalThis\.global=globalThis,process=\{env:\{\},versions:\{\}\},\(\(\)=>\{/,
    'globalThis.global=globalThis,var process={env:{},versions:{}},(()=>{'
  )

  // Pattern 2: second process={} that would overwrite env/versions
  // Change from: }),process={};function
  // To: });void 0;function
  content = content.replace(
    /\}\),process=\{\};function/,
    '}),void 0;function'
  )

  // Pattern 3: So(process,{_debugEnd:...}) or Sl(process,{_debugEnd:...})
  // This is Object.assign(process, {...}) - fine to keep as is

  fs.writeFileSync(file, content, 'utf8')
  console.log('[fix-workers] Patched:', path.basename(file))
}
