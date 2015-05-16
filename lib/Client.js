var API = require('wechat-api');

const EMPTY_FUNC = function(token,callback){ callback(); };

var HOOKS = {}

function Client( component , user , getToken , saveToken){

	this.component = component;
	this.user = user;
	this.api = new API( user.appid , '' , getToken , saveToken );

}

	var ignores = ['preRequest'];

Object.keys(API.prototype).forEach(function(method){


	if( typeof API.prototype[method] != 'function' || ignores.indexOf(method) != -1 ) return;

	Client.prototype[method] = function(){

		var temp_data = {};

		var args = Array.prototype.slice.call(arguments)
			, func = args.pop()
			, method_name = arguments.callee.__name
			, that = this
			, hook = that.hooks[method_name]
			, cb_with_after = func;


		if( hook && typeof hook.after === 'function' ){
			cb_with_after = function( err , data ){
				if( err ) return func( err );
				hook.after.call(that,err,data,func,temp_data);
			};
		}

		if( hook && typeof hook.before === 'function' ){
			var before_args = [].concat(args);
			before_args.push(function(){
				that.api[method_name].apply(that.api,args);
			});
			before_args.push(temp_data);
			args.push(cb_with_after);
			hook.before.apply(that,before_args);
		}else{
			args.push(cb_with_after);
			that.api[method_name].apply(that.api,args);
		}

	};

	Client.prototype[method].__name = method;

});

Client.prototype.hooks = require('./hooks');

module.exports = Client;
