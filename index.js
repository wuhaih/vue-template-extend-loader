const validateOptions = require('schema-utils');
const { getOptions } = require('loader-utils');
const HrxExtenderLoader = require('./HrxExtenderLoader');
const { name, extenderOptions, schemaOptions } = require('./config.json');

module.exports = function(source) {
    // 告诉 Webpack 本次转换是异步的，Loader 会在 callback 中回调结果
    const callback = this.async();

    // 校验配置
    // extenderOptions 配置扩展模式，append
    const options = {...extenderOptions, ...getOptions(this)};
    try {
        validateOptions(schemaOptions, options, name);
    } catch (error) {
        return callback(error, source);
    }

    const { tag_extender } = options;//hrxExtender
    const EXTENDER_REGEXP = new RegExp(`<${tag_extender}\\b`, 'i'); //以hrxExtender开始，执行对大小写不敏感的匹配

    // hrxExtender标签不存在, 直接退出
    const extender_matcher = source.match(EXTENDER_REGEXP);
    if (!extender_matcher) return callback(null, source); //source不处理返回

    // 开始处理模板扩展
    const hrxExtenderLoader = new HrxExtenderLoader(source, callback, options, this);
    hrxExtenderLoader.handleExtendVueTemplate();
};