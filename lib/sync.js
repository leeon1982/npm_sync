// 若指定版本,则同步指定版本tarball和最新版本tarball
// 同步逻辑
// 1.同步json文档
// 	获取本地库的json文件和远程库的json文档
//	若_rev不相等,则使用远程库的同步本地库的json文档
//		下载远程库的json文档,修改tarball路径,上传到本地库中
// 2.同步tarball
// 	获取tarball文档
// 	若没有,则新建
// 	若有
// 		查看对应的附件版本号是否存在
// 			若存在,则结束
// 			否则,从远程上传对应tarball到本地库对应文档的附件上
// 3.读取dependencies字段
// 	递归同步依赖

Object.defineProperty(global, '__stack', {
	get: function(){
		var orig = Error.prepareStackTrace;
		Error.prepareStackTrace = function(_, stack){ return stack; };
		var err = new Error;
		Error.captureStackTrace(err, arguments.callee);
		var stack = err.stack;
		Error.prepareStackTrace = orig;
		return stack;
	}
})
Object.defineProperty(global, '__line', {
	get: function(){
		return __stack[1].getLineNumber();
	}
})

const request = require('request')
const async = require('async')

/**
 * 修改url为以一个/结束
 * @param  {[type]} url [description]
 * @return {[type]}     [description]
 */
function normalizeUrl(url) {
	return url.replace(/\/*$/, '/')	// normalize
}

/**
 * 获取registry中对应id的文档rev字段
 * 
 * getDocRev('https://registry.npmjs.org/', 'jquery-ui', callback)
 * 
 * @param  {[type]}   registry [description]
 * @param  {[type]}   id       [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
function getDocRev(registry, id, callback) {
	request.get({
	    url: normalizeUrl(registry)+encodeURIComponent(id)+'?revs=true'    // revs设为true貌似没啥卵用, revs_info
	}, function (error, response, body) {
		try{
			var doc = JSON.parse(body)
			callback(null, doc._rev)
		} catch(e){
			callback(e)
		}
	})
}

/**
 * 创建或更新文档
 *
 *	createOrUpdateDoc('http://yaolin:123456@35.201.153.103:5984/test_attach/', 'jquery-ui', '10-431707a9073e6fada7ad686c06bd8809', {a:10, _rev: '10-431707a9073e6fada7ad686c06bd8809'})
 * 
 * @param  {[type]} registry [description]
 * @param  {[type]} id       [description]
 * @param  {[type]} newRev   [description]
 * @param  {[type]} doc      [description]
 * @return {[type]}          [description]
 */
function createOrUpdateDoc(registry, id, newRev, newDoc) {
	// 保存到库中
    // new_edits 如果发生冲突就会在文档中生成conlicts字段，理论上不会产生冲突，因为是单向同步且不会手动修改私有库数据
    // 对于同一个rev不能修改数据
    // rev由于new_edits设为了false，所以必须传rev
    console.log(normalizeUrl(registry)+encodeURIComponent(id) + '?new_edits=false&rev=' + newRev)
    request.put({
        url: normalizeUrl(registry)+encodeURIComponent(id) + '?new_edits=false&rev=' + newRev,	// new_edits设为false，必须要传入一个well-formed且和库中不一样的rev才会更新或添加成功
        json: newDoc
    }, function (error, response, body) {
    	console.log(__line+': ')
        console.log('error:', error)
        // console.log('response:', response)
        console.log('body:', body)
    })
    // fs.writeFile('b1.json', JSON.stringify(doc))
}

/**
 * 将localRegistry中对应id的文档同步为remoteRegistry中最新的文档
 * @param  {[type]} remoteRegistry [description]
 * @param  {[type]} localRegistry  [description]
 * @param  {[type]} id             [description]
 * @param  {[type]} localRev       [description]
 * @param  {[type]} remoteRev      [description]
 * @param  {[type]} options        [description]
 * @return {[type]}                [description]
 */
function _syncDoc(remoteRegistry, localRegistry, id, localRev, remoteRev, options) {

	request.get({
	    url: normalizeUrl(remoteRegistry) + encodeURIComponent(id) +'?revs=true'    // revs设为true貌似没啥卵用, revs_info
	}, function (error, response, body) {	    
	    var doc = JSON.parse(body)

		var flow = []
		if(options && options.editNpmJson){
			flow = flow.concat(options.editNpmJson)
		}

		flow.push(createOrUpdateDoc)
		async.applyEach(flow, localRegistry, id, remoteRev, doc, options, function(error){
			if(error){
				console.log(__line+': 同步doc文档到本地数据库失败')
			} else {
				console.log(__line+': 同步doc文档到本地数据库成功')	
			}
		})
	})
}

/**
 * 修改文档的tarball字段为指定的tarball字段
 * @param {[type]} registry [description]
 * @param {[type]} id       [description]
 * @param {[type]} newRev   [description]
 * @param {[type]} newDoc      [description]
 */
function setTarball(registry, id, newRev, newDoc, options){
	if(newDoc && newDoc.versions){
		for (var v in newDoc.versions) {
	        var version = newDoc.versions[v]
	        // version.dist = 'ggg'
	        // version.dist.tarball = 'eeee'
	        // version.dist.shasum = '8e223a9951ee37b119ac57a1714b441cf36aa070'
	        if(version && version.dist && version.dist.tarball){
		        var tarball = version.dist.tarball.replace(/.*\//, '')
		        if(tarball.endsWith('.tgz')){
		        	version.dist.tarball = options.TARBALL_DATABASE + encodeURIComponent(id)+'/'+tarball	
		        } else {
		        	console.log(__line+': tarball格式好像有问题')
		        }
	        } else {
				console.log(__line+': tarball字段不存在')
	        }
	        
	    }
	}
}


/**
 * 同步文档业务逻辑
 * @param  {[type]} remoteRegistry [description]
 * @param  {[type]} localRegistry  [description]
 * @param  {[type]} id             [description]
 * @param  {[type]} options        [description]
 * @return {[type]}                [description]
 */
function syncDoc(remoteRegistry, localRegistry, id, options) {

	async.parallel({
		remoteRev: function(callback) {
			getDocRev(remoteRegistry, id, callback)
		},
		localRev: function(callback) {
			getDocRev(localRegistry, id, callback)
		}
	}, function(error, results) {
		if(error){
			console.log(__line+': 获取远程库或本地库json文档出错了')
		} else if(results.remoteRev !== results.localRev) {
			_syncDoc(remoteRegistry, localRegistry, id, results.localRev, results.remoteRev, {
				editNpmJson: [setTarball],
				TARBALL_DATABASE: 'http://35.201.153.103:5984/tarball/'
			})
		} else {
			console.log(__line+': 远程库json文档和本地库的json文档相同')
		}
	})
}




syncDoc('https://registry.npmjs.org/', 'http://yaolin:123456@127.0.0.1:5984/registry', 'jquery-ui')