var API = require('wechat-api');

const EMPTY_FUNC = function(token,callback){ callback(); };

var HOOKS = {}

function Client( appid , appsecret , getToken , saveToken){
	this.api = new API( appid , appsecret , getToken , saveToken );

}

	var ignores = ['preRequest'];

Object.keys(API.prototype).forEach(function(method){


	if( typeof API.prototype[method] != 'function' || ignores.indexOf(method) != -1 ) return;

	Client.prototype[method] = function(){


		var args = Array.prototype.slice.call(arguments)
			, func = args[args.length - 1]
			, method_name = arguments.callee.__name
			, that = this
			, hook = that.hooks[method_name];


		if( hook && typeof hook.after === 'function' ){
			args.pop();
			args.push(function( err , data ){
				if( err ) return func( err );
				hook.after(data,func);
			});
		}

		if( hook && typeof hook.pre === 'function' ){
			hook.pre(args,function(){
				that.api[method_name].apply(that.api,args);
			});
		}else{
			that.api[method_name].apply(that.api,args);
		}

	};

	Client.prototype[method].__name = method;

});

Client.prototype.hooks = {

};

module.exports = Client;
