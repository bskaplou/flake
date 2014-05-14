(function (){
    var _ = require('underscore');
    var log = function(level, msg) {
        console.log(level, msg);
    };
    
    function parse_template(str, result, exp) {
        if(! result) {
            exp = /(.*?)\{(.+?)\}/;
            result = [];
        }
        var m = exp.exec(str);
        if(m) {
            str = str.slice(m[0].length);
            if(m[1].length > 0) {
                result.push({'type': 'const', 'value': m[1]});
            }
            result.push({'type': 'var', 'value': m[2]})
            if(str.length > 0) {
                parse_template(str, result, exp)
            }
        } else {
            result.push({'type': 'const', 'value': str});
        }
        return result;
    }
    
    function match_template(template, str) {
        var re = new RegExp('^' + _.reduce(_.map(template, function(e) {
            return e['type'] == 'var' ? '(.*?)' : e['value'];
        }), function(a,b){ return a + b;}) + '$');
        var ma = re.exec(str);
        if(ma) {
            var values = {};
            _.each(_.filter(template, function(o){return o.type == 'var';}), function(o, pos){
                values[o.value] = ma[pos + 1];
            });
            return values;
        }
    }
    
    function exec_template(template, context) {
        return _.reduce(template, function(acc, step){
            if(step.type == 'const') {
                return acc + step.value;
            } else {
                return acc + context[step.value];
            }
        }, '');
    }
    
    var ruleset = [];
    function rule(output, input, func) {
        if(! _.isArray(input)) {
            input = [input];
        }
        if(! _.isArray(output)) {
            output = [output];
        }
        ruleset.push({
            'output': _.map(output, function(o) {return parse_template(o);}), 
            'input': _.map(input, function(i) {return parse_template(i);}), 
            'transformer': func
        });
        return ruleset;
    }
    
    function build(output, files) {
        log('debug', 'trying to build ' + output);
        var match;
        var rule = _.find(ruleset, function(r){
            return _.find(r.output, function(t) {
                match = match_template(t, output);
                return match;
            })
        });
        if(rule) {
            var src_names = _.map(rule.input, function(t){return exec_template(t, match);});
            _.each(_.filter(src_names, function(src_name){return src_name.indexOf('*') == -1;}), function(src_name){build(src_name, files);});
            var dst_names = _.map(rule.output, function(t){return exec_template(t, match);});
            var src_files = _.map(src_names, function(src) {
                var match_re = new RegExp('^' + src.replace('**', '.+').replace('*', '[^\/]+') + '$');
                var matching_sources = _.filter(_.keys(files), function(key){
                    return match_re.test(key);
                });
                return matching_sources;
            });
            var src_freshness = _.max(_.map(_.flatten(src_files), function(file) {return files[file].last_modified;}));
            var dst_freshness = 0;
            var dst_files = _.pick(files, dst_names);
            if (_.size(dst_names) == _.size(dst_files)) {
                dst_freshness = _.min(_.map(dst_files, _.property('last_modified')));
            }
            if(src_freshness > dst_freshness) {
                var src_content = _.map(src_files, function(src){return _.map(src, function(file){ return _.result(files[file], 'content');});});
                _.each(_.flatten([rule.transformer(src_content, src_files)]), function(content, pos) {
                    files[dst_names[pos]] = {'content': content, 'last_modified': src_freshness, 'myboy': 1};
                    log('debug', 'file ' + dst_names[pos] + ' built successfully');
                });
            } else {
                if(src_freshness < 0 && !_.isFinite(src_freshness)) {
                    log('debug', 'no source files ' + src_names + ' found for ' + output);
                } else {
                    log('debug', 'file ' + output + ' is fresh!');
                }
            }
        } else {
            log('debug', 'rule not found for output: ' + output);
        }
        return files;
    }
    
    var walk = require('walk');
    var fs = require('fs');
    
    function load_files(path) {
        function load_content(path) {
            return fs.readFileSync(path, {encoding: 'utf8'});
        } 
        var result = {};
        var options = {
            followLinks: false,
            listeners: {
                file: function(root, stats, next) {
                    var path = root + '/' + stats.name;
                    if(path[0] == '.' && path[1] == '/') {
                        path = path.slice(2);
                    }
                    result[path] = {
                        last_modified: stats.mtime.getTime() + stats.mtime.getTimezoneOffset() * 60 * 1000,
                        content: _.partial(load_content, path)
                    }
                    next();
                }
            }
        }
        _.each(_.flatten([path]), function(p) {walk.walkSync(p, options);})
        return result;
    }
    
    function save_files(files) {
        _.each(_.filter(_.keys(files), function(k) {return 'myboy' in files[k];}), function(path) {
            fs.writeFileSync(path, files[path].content);
        });
    }
    
    function build_and_save(target, path) {
        save_files(build(target, load_files(path)));
    } 
    
    exports.rule = rule;
    exports.build_and_save = build_and_save;
})();
