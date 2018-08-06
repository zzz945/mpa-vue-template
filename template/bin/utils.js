var os = require('os')
var path = require('path')
var glob = require('glob')
var fs = require('fs')
var webpack = require('webpack')
var config = require('./config.js')
var assign = require('object-assign')
var shell = require('shelljs')
var colors = require('colors')

function resolve(dir) {
  return path.join(__dirname, '..', dir)
}

function assetsPath(filepath) {
  var dir = process.env.NODE_ENV === 'production' ? config.prod.assetsRoot : config.dev.assetsRoot
  return path.posix.join(dir, filepath)
}

exports.getEntries = function(extensions, options) {
  const res = {}
  options = options || {}
  const verbose = options.verbose || true
  extensions = extensions || ['.js']
  extensions.forEach(function(validExt) {
    const srcDir = config.paths.src
    const files = glob.sync(srcDir + "/**/*" + validExt, options).filter(function(filepath) {
      const extension = path.extname(filepath)
      const basename = path.basename(filepath, validExt)
      if (extension != validExt) return false
      if (!options.noskip && basename[0] == '_') return false
      if (!basename.match(/^[A-Za-z_0-9-]+$/)) return false
      /**
       * file is not an entry if it's content
       * start with not entry multiline comment
       */
      var buf = new Buffer(13)
      var fd = fs.openSync(filepath, 'r')
      fs.readSync(fd, buf, 0, 13)
      var directive = buf.toString()
      fs.closeSync(fd)
      return directive !== '/*not entry*/'
    })
    const includes = options.includes ? options.includes.split(',') : null
    console.log('includes for ', extensions, includes)
    const excludes = options.excludes ? options.excludes.split(',') : null
    console.log('excludes for ', extensions, excludes)
    files.forEach(function(filepath) {
      var key = path.relative(options.baseDir || config.paths.src, filepath)
      key = key.replace(validExt, '')
      if (includes) {
        if (includes.indexOf(key) < 0) return
      } else if (excludes) {
        if (excludes.indexOf(key) >= 0) return
      }
      res[key] = filepath
    })
  })
  if (verbose) {
    console.log(('Entries for ' + extensions.join(' and ')).cyan.bold)
    for (var k in res) {
      console.log(k.green, '=>\n  ', res[k].yellow)
    }
  }
  if (!Object.keys(res).length) {
    console.error('!!!Got no entry for ' + extensions + '!!!')
  }
  return res
}

const ImageNames = {
  dev: 'img/[path][name].[ext]',
  prod: 'img/[path][name]-[hash:7].[ext]'
}
exports.getImageLoader = function(env, limit) {
  return {
    test: /\.(png|jpe?g|gif|svg)(\?.*)?$/,
    loader: 'url-loader',
    query: {
      emitFile: false, // 这里只负责生成url, copy plugin负责拷贝图片
      context: path.join(config.paths.src, 'img'),
      limit: limit || 10000,
      name: ImageNames[env]
    }
  }
}

const FontNames = {
  dev: 'fonts/[name].[ext]',
  prod: 'fonts/[name]-[chunkhash].[ext]'
}

exports.getFontsLoader = function(env, limit) {
  return {
    test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/,
    loader: 'url-loader',
    query: {
      limit: limit || 10000,
      name: FontNames[env]
    }
  }
}

exports.getJsLoader = function(jsPattern, opts) {
  const config = {
    test: jsPattern || /\.js$/,
    loader: 'babel-loader'
  }
  return Object.assign(config, opts)
}

exports.getVueLoader = function (env, options) {
  const loader = {
    test: /\.vue$/,
    loader: 'vue-loader'
  }
  if (options) {
    loader.options = options
  }
  return loader
}

const CssNames = {
    dev: '[name].css',
    prod: '[name]-[chunkhash].css'
  }
  /**
   * this loader compile stylus files into css files
   * @param  {Boolean} withPlugin
   * @return {Object} [{test,loader} | {loader,plugins}]
   */
exports.getStylusLoaderMaybeWithPlugin = function(withPlugin, env) {
  const test = /\.styl$/
  var loader
  if (withPlugin) {
    var ExtractTextPlugin = require('extract-text-webpack-plugin')
    var loaderStr = env == 'dev' ?
      'css-loader!stylus-loader' : 'css-loader?minimize=true!stylus-loader'
    return {
      loader: {
        test: test,
        loader: ExtractTextPlugin.extract({
          use: loaderStr,
          remove: false
        })
      },
      plugins: [
        new ExtractTextPlugin(CssNames[env])
      ]
    }
  } else {
    // plain stylus loader
    // insert css as style node into DOM
    return {
      test: test,
      loader: 'style-loader!css-loader!stylus-loader'
    }
  }
}

exports.getLessLoader = function (env) {
  var loaderStr = env == 'dev' ?
    'style-loader!css-loader!less-loader' : 'style-loader!css-loader?minimize=true!less-loader'
  return {
    test: /\.less$/,
    loader: loaderStr
  }
}

function try_require(path_) {
  var json = {}
  try {
    if (fs.existsSync(path_)) {
      json = require(path_)
    }
  } catch (e) {}
  return json
}

/**
 * this loader just copy jade file to views for express
 * @param  {Boolean} withPlugin
 * @param  {String} env ['dev' | 'prod']
 * @return {Object} [{test,loader} | {loader,plugins}]
 */
exports.getJadeLoaderPluginMaybeWithPlugin = function(withPlugin, env) {
  const test = /\.jade$/
  var manifest = null
  if (withPlugin) {
    var ExtractTextPlugin = require('extract-text-webpack-plugin')
    return {
      loader: {
        test: test,
        loader: ExtractTextPlugin.extract({
          use: {
            loader: 'jade-url-replace-loader',
            options: {
              attrs: ['a:href', 'img:src','script:src','link:href', 'video:src', 'source:src', 'audio:src', 'img:data-src'],
              getEmitedFilePath: function (url) {
                if (env == 'dev') return url
                if (!manifest) {
                  var assetsRoot = config[env].assetsRoot
                  var m1 = try_require(path.join(assetsRoot, 'manifest-js.json'))
                  var m2 = try_require(path.join(assetsRoot, 'manifest-stylus.json'))
                  var m3 = try_require(path.join(assetsRoot, 'manifest-img.json'))
                  manifest = assign({}, m1, m2, m3)
                  console.log()
                  console.log('Process view files')
                  console.log('Manifest from previous compilation:')
                  for (var file in manifest) {
                    console.log(' ' + file.green + ' => \n   ' + manifest[file].yellow)
                  }
                }
                var hashed = manifest[url]
                if (hashed) {
                  return hashed
                } else {
                  if (url.indexOf('/lib/') < 0) {
                    if (url.indexOf('javascript:;') === 0 ||
                      url.indexOf('mailto:') === 0 ||
                      url.indexOf('http') === 0 ||
                      url.indexOf('#{') === 0) {
                        //do not care above url
                    }  else {
                      console.warn('Not found ' + url + ' in manifest files'.magenta)
                    }
                  }
                  return url
                }
              }
            }
          }
        })
      },
      plugins: [
        new ExtractTextPlugin('[name].jade')
      ]
    }
  } else {
    // plain jade loader
    // return a render function
    return {
      test: test,
      loader: 'jade-loader'
    }
  }
}

const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g
var FriendlyErrorsPlugin = require('friendly-errors-webpack-plugin')
var WebpackNotifierPlugin = require('webpack-notifier');
exports.getWebpackDevHelperPlugins = function(title, opts) {
  opts = opts || {}
  opts.title = (opts.title || title).replace(ansiRegex, '')
  return [
    new FriendlyErrorsPlugin(),
    new WebpackNotifierPlugin(opts)
  ]
}

var WebpackMd5Hash = require('webpack-md5-hash');
exports.getWebpackProdHelpPlugins = function() {
  const plugins = [
    new webpack.optimize.UglifyJsPlugin({
      compress: {
        warnings: false
      }
    }),
    new webpack.optimize.OccurrenceOrderPlugin(),
    new WebpackMd5Hash()
  ]
  return plugins
}

var CopyWebpackPlugin = require('copy-webpack-plugin')
var crypto = require('crypto')
var manifsetImg = {}
exports.getCopyPlugins = function (env, assetsPublicPath) {
  var tpl = env === 'dev' ? '[path][name].[ext]' : '[path][name]-[hash:7].[ext]'
  return new CopyWebpackPlugin([{
    context: path.join(config.paths.src, 'img'),
    from: '**/*',
    to: path.join(config[env].assetsRoot, 'img/' + tpl),
    transform: function (content, filepath) {
      var hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 7)
      var ext = path.extname(filepath)
      var dir = path.dirname(filepath)
      var basename = path.basename(filepath, ext)
      if (basename[basename.length - 1] == '_') return content
      var relativePath = path.relative(config.paths.src, dir)
      var imgPathNoHash = relativePath + '/' + basename + ext
      var imgPath = relativePath + '/' + basename + '-' + hash + ext
      manifsetImg[assetsPublicPath + imgPathNoHash] = assetsPublicPath + imgPath
      fs.writeFileSync(path.join(config[env].assetsRoot, 'manifest-img.json'), JSON.stringify(manifsetImg, null, 2))
      return content
    }
  /* copy static files, add more if needed */
  }, {
    from: path.join(config.paths.src, 'css/lib'),
    to: path.join(config[env].assetsRoot, 'css/lib')
  }, {
    from: path.join(config.paths.src, 'js/lib'),
    to: path.join(config[env].assetsRoot, 'js/lib')
  }, {
    from: path.join(config.paths.src, 'fonts'),
    to: path.join(config[env].assetsRoot, 'fonts')
  }, {
    from: path.join(config.paths.src, 'html/sitemap.xml'),
    to: path.join(config.paths.views, 'sitemap.xml')
  }, {
    from: path.join(config.paths.src, 'html/robots.txt'),
    to: path.join(config.paths.views, 'robots.txt')
  }])
}

exports.safeRm = function (_path) {
  var err = false
  if (_path == "/") err = true
  if (_path.toLowerCase() == os.homedir()) err = true
  if (path.relative(config.paths.root, _path).indexOf('../') == 0) err = true
  if (err) {
    console.error(_path, ' is not contained in project folder, will not remove!')
    return
  } else {
    try {
      console.info('try to remove ', _path)
      shell.rm('-r', _path)
      console.info('done!')
    } catch (err) {
      console.error('FATAL:', err)
    }
  }
}

exports.assetsPath = assetsPath
exports.resolve = resolve
