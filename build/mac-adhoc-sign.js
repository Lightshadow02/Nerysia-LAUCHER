// Hook electron-builder (afterPack) : signature "ad-hoc" de l'app macOS.
//
// Sans certificat Apple Developer (payant), electron-builder ne signe pas l'app.
// Or une app non signee ne se lance PAS du tout sur les Mac Apple Silicon (M1/M2/M3...) :
// macOS la declare "endommagee". La signature ad-hoc (identite "-") suffit pour qu'elle
// demarre ; le joueur doit juste autoriser l'app une fois (cf docs/INSTALLATION.md).
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function(context) {
    if(context.electronPlatformName !== 'darwin') return
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    console.log(`  • signature ad-hoc de ${appPath}`)
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
