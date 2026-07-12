const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const zipPath = '/home/chase/Downloads/InventivetalentDev minecraft-assets 26.1.2 assets-minecraft_textures.zip'
const outDir = path.resolve(__dirname, '..', 'dist', 'textures')

if (!fs.existsSync(zipPath)) {
  console.log('[extract-textures] Zip not found at', zipPath, '- skipping extraction')
  process.exit(0)
}

fs.mkdirSync(outDir, { recursive: true })

// Write python script to temp file
const scriptPath = path.join(outDir, '..', '_extract.py')
const pyScript = `
import zipfile, json, os

zip_path = ${JSON.stringify(zipPath)}
out_dir = ${JSON.stringify(outDir)}

with zipfile.ZipFile(zip_path) as z:
    names = [n for n in z.namelist() if not n.endswith('/')]
    texture_files = [n for n in names if not n.endswith('.json') and not n.endswith('.mcmeta')]

    for name in texture_files:
        z.extract(name, out_dir)

    atlas_names = set()
    for n in texture_files:
        base = n.rsplit('.', 1)[0]
        if base.startswith('block/'):
            atlas_names.add(base[6:])
        else:
            atlas_names.add(base)

    with open(os.path.join(out_dir, 'texture_names.json'), 'w') as f:
        json.dump(sorted(atlas_names), f)

    print(f'Extracted {len(texture_files)} textures, {len(atlas_names)} atlas names')
`

fs.writeFileSync(scriptPath, pyScript)
const result = spawnSync('python3', [scriptPath], { stdio: 'inherit' })
fs.unlinkSync(scriptPath)

if (result.status !== 0) {
  process.exit(result.status || 1)
}
