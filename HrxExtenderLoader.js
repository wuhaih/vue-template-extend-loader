const fs = require('fs');
const cheerio = require('cheerio');
//cheerio是jquery核心功能的一个快速灵活而又简洁的实现，主要是为了用在服务器端需要对DOM进行操作的地方

const IMPORTS_REGEXP = /(?<!\/{2}\s*)import\s+(\w+)\s+from\s+["']([^"']+)["']/;
const IMPORTS_REGEXP_GLOBAL = new RegExp(IMPORTS_REGEXP, 'g');
const EXTENDS_KEY_REGEXP = /extends:?\s*(\w+)/;
const COMPONENT_NAME = /^[a-zA-Z0-9]{2,50}$/;

class HrxExtenderLoader {
    /**
     * loader的构造函数
     * @param {*} source source 为 compiler 传递给 Loader 的一个文件的原内容
     * @param {*} callback 通过 this.callback 告诉 Webpack 返回的结果
     * @param {*} options loader传入的option，
     * @param {*} loaderInterface 
     */
    constructor(source, callback, options, loaderInterface) {
        this.source = source;
        this.callback = callback;
        this.options = options;
        this.loaderInterface = loaderInterface;
        //console.log('options', options)
        //console.log('loaderInterface', loaderInterface)

        this.imports = [];
        this.extenders = [];

        this.init();
    }

    init() {
        const source = this.source;
        // cheerioOptions:{"xmlMode": true,"decodeEntities": false}
        // taf_extender: hrxExtender
        const { cheerioOptions, tag_extender } = this.options || {};
        const $ = this.$ = cheerio.load(source, cheerioOptions);;
        // imports 列表
        let imports = source.match(IMPORTS_REGEXP_GLOBAL);
        if (imports) {
            this.imports = imports.map(notation => {
                const [, variable, path] = notation.match(IMPORTS_REGEXP);
                return { variable, path };
            });
        }

        // extenders 列表
        let extenders = $(tag_extender);
        if (extenders.length) {
            this.extenders = this.getExtenders(extenders);
        } else {
            this.callback(null, source);
        }
    }

    /**
     * 处理vue继承模板
     * @returns 
     */
    async handleExtendVueTemplate() {
        const callback = this.callback;
        const extenders = this.extenders || [];
        const $ = this.$;
        const { cheerioOptions, tag_template, handler  } = this.options || {};
        const _emptyRemoved = (path, ext) => {
            if (!path) { ext.remove && ext.remove(); return true; }
        };
        const _pruneTpl = () => {
            let targetTpl = $(tag_template).eq(0);
            let html = targetTpl.html().trim();
            // 如果template节点为空, 直接删除, 防止报错
            if (!html) targetTpl.remove && targetTpl.remove();
        
            callback(null, $.html());
        };

        // 提前返回清理后的内容
        if (extenders.length < 1) return _pruneTpl();

        // 替换source的内容
        for (const extender of extenders) {
            let { ext: extEl, path, exts } = extender;
            
            // 按指令处理内容
            try {
                if (_emptyRemoved(path, extEl)) continue;

                const respath = await this.resolvePath(path);
                if (_emptyRemoved(respath, extEl)) continue;

                // 加载base内容
                const base = fs.readFileSync(respath, { encoding: 'utf-8' });
                const $$ = cheerio.load(base, cheerioOptions);
    
                // 获取base的顶层template节点
                const baseTpl = $$(tag_template).eq(0);
                // 循环hrxExtend指令节点, 处理base顶层template节点的HTML
                exts.forEach((_extends) => {
                    let { ext, query, mode } = _extends;
                    if (!query || !mode) {
                        if (_emptyRemoved(null, ext)) return;
                    }
                    const baseEl = baseTpl.find(query);
                    if (baseEl.length < 1 || typeof baseEl[mode] !== 'function') {
                        if (_emptyRemoved(null, ext)) return;
                    }
    
                    this._handleExtend(query, mode, baseEl, ext, handler);
                });
    
                // 将target中hrxExtender节点替换为baseTpl内容
                const html = baseTpl.html();
                extEl.replaceWith && extEl.replaceWith(html);
                
                // base加入依赖列表
                this.addDependency(respath);
            } catch (error) {
                _emptyRemoved(null, extEl);

                this.emitError(error);
            }
        }
    
        // 返回清理后的内容
        _pruneTpl();
    }

    /**
     * 
     * @param {*} query 
     * @param {*} mode 
     * @param {*} baseEl 
     * @param {*} extEl 
     * @param {*} handler 
     * @returns 
     */
    _handleExtend(query, mode, baseEl, extEl, handler) {
        if (handler && typeof handler === 'function') {
            handler(query, mode, baseEl, extEl);
            return;
        }
        
        const $ = this.$;
        let html = (extEl.html() || '').trim();
        if (mode === 'remove') html = void 0;

        baseEl[mode](html);
    }

    getExtenders(extenders) {
        const $ = this.$;
        const { 
            extender_prop_path, 
            tag_extends,
            extends_prop_query,
            extends_prop_mode,
            extends_prop_mode_default,
            mode: EXTENDS_MODES = {}, 
        } = this.options || {};

        const _extenders = [];
        
        let f = 0;
        extenders.each((_, el) => {
            const ext = $(el);

            let path = ext.attr(extender_prop_path);
            if (!path && !f) {
                path = this.getBaseComponentPath();
                f += 1
            };
            path = (path || '').trim();
            if (!path) {
                _extenders.push({ ext, path, exts: [] });
                return;
            }

            // 如果路径是引入的`组件变量名`, 则从imports列表中转换
            if (COMPONENT_NAME.test(path)) {
                path = this.getImportComponentPath(path);
            }

            let exts = [];
            ext.find(tag_extends).each((_, el) => {
                const _ext = $(el);
                const query = _ext.attr(extends_prop_query);
                let mode = _ext.attr(extends_prop_mode) || extends_prop_mode_default;
                mode = EXTENDS_MODES[mode];

                exts.push({ ext: _ext, query, mode });
            });
            
            _extenders.push({ ext, path, exts });
        });

        return _extenders;
    }

    addDependency(respath) {
        respath && this.loaderInterface.addDependency(respath);
    }

    resolvePath(path) {
        const loaderInterface = this.loaderInterface;

        return new Promise((resolve, reject) => {
            loaderInterface.resolve(loaderInterface.context, path, (error, result) => {
                if (error) { reject(error); }
                else { resolve(result); }
            });
        });
    }

    getBaseComponentPath() {
        const source = this.source;

        let baseComponentName = source.match(EXTENDS_KEY_REGEXP);
        if (baseComponentName) {
            baseComponentName = baseComponentName[1];
            return this.getImportComponentPath(baseComponentName);
        }

        return '';
    }

    getImportComponentPath(name) {
        const imports = this.imports || [];
        //console.log('----------getImportComponentPath---------------')
        if (imports && name) {
            const importNotation = imports.find(({ variable }) => variable.toLowerCase() === name.toLowerCase());
            const importComponentPath = importNotation && importNotation.path || '';
            //console.log('importComponentPath', importComponentPath)
            return importComponentPath
            //return importNotation && importNotation.path || '';
        }

        return '';
    }

    emitError(error) {
        error && this.loaderInterface.emitError && this.loaderInterface.emitError(error);
    }
}

module.exports = HrxExtenderLoader;
