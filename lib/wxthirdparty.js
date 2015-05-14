/*
 *
 * 调用方式：
 *	var thirdparty = new ThirdpartyServer(
 *		appid,
 *		secret,
 *		token,
 *		key, // 公众号消息加解密Key
 *		database_config, // orm2 连接数据库的字符串，如果主从库是分开的，传递object:{read:'xxxxxxxxx',write:'xxxxxxxxx'}
 *		is_cluster //！！！！！！！！！！如果你的server用的cluster，这个参数超级超级超级超级重要，仔细读下面的注意事项！！！！！！！！！！！！！！
 *	);
 *	thirdparty.start();
 *
 *	另外在授权事件接收URL的响应函数中一定要调用save_ticket方法以刷新ticket：
 *	
 *	//首先在中间件里获取post的数据
 *	some_middleware: function(req,res){
 *		req.on('data',function(d){
 *			req.body += d.toString();
 *		});
 *	};
 *	// 然后在授权事件接受URL的响应函数中存储ticket
 *	'auth_callback_action': function(req,res){
 *		thirdparty.save_ticket(req.body);
 *	}
 *
 * 注意事项：
 *
 *	本模块需要在两个server中分别调用:
 *		一个单进程的模块用于向微信api拉取access_token等私密信息，is_cluster传false或者不传，这个server需要一直保持运行，不需要附加其他任何业务
 *		另一个就是在实际server中用于发起微信公众号api调用，这个可以在cluster中启动, is_cluster一定要传true，否则会导致token混乱，而且access_token拉取次数是有限制的，拉完就米有了
 *
 *	由于ticket是微信服务器向第三方平台推送的，所以每次重启server的时候都很难保证当前的ticket是否还有效
 *	重启server时先启动cluster的server，在授权事件接收URL的处理函数中调用save_ticket方法，10分钟之内就会收到微信的push请求，
 *	这个过程中最好停用所有和授权有关的功能，直到ticket刷新(这个过程中最好不要启动单进程的server，
 *	如果ticket已经失效会浪费好几次获取access_token的请求)，可以在代码中记录ticket推送事件，接到推送之后再启用授权并启动单进程的server
 *	
 *
 */
exports.ThirdpartyServer = require('./ThirdpartyServer');
//exports.Client = require('./Client');
