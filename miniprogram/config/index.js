const path = require('path')

module.exports = {
  projectName: 'banxingbansong',
  date: '2026-9-19',
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  // 逻辑层在仓库根目录的 shared/，与网页端共用同一份文件，因此不能复制一份到小程序目录
  alias: {
    '@shared': path.resolve(__dirname, '..', '..', 'shared')
  },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false }
    }
  }
}
