## 安装：
	git clone git@github.com:windinsky/wxthirdparty.git
	cd $node_modules_path/wixthirdparty
	npm install

是不是很想直接npm install？哈哈哈哈哈哈哈哈哈，我不会弄。。。。

## 调用：
```js
	
/**********  app.js  *********/

var appid = '第三方应用appid'
, appsecret = '第三方应用appsecret'
, token = '第三方应用中设置的公众号消息校验Token'
, key = '第三方应用中设置的公众号消息加解密Key'
, db = 'mysql://user:password@host/yourdatabase';


if (cluster.isMaster) {
	// Fork workers.
	for (var i = 0; i < numCPUs; i++) cluster.fork();
	
	// 主进程的模块只负责刷新component_token和pre_auth_code
	global.thirdparty = new ThirdpartyServer(
		appid , 
		appsecret , 
		token , 
		key , 
		db 
	);
	thirdparty.start();

	cluster.on('exit', function(worker, code, signal) {
		console.log('worker ' + worker.process.pid + ' died');
		cluster.fork();
	});
	
	thirdparty.once('ready' , function(){
		// enable_auth_related_actions();
	})

} else {
	// 负责所有第三方平台的业务逻辑以及对公众号的操作，注意最后一个参数
	global.thirdparty = new ThirdpartyServer( 
		appid , 
		appsecret , 
		token , 
		key , 
		db , 
		true // very important
	);
	
	// Workers can share any TCP connection
	// In this case its a HTTP server
	http.createServer(function(req, res) {
		// ...
	}).listen(80);
}

/***********  使用样例，展示follower的头像  **********/

app.get('show_head_img',function(req,res){

	// 根据cookie从数据库中获取公众号信息
	thirdparty.get_user_info( req.cookie.wx_token , function( err , user_info ){

		if( err ) res.end(JSON.stringify(err));

		var client = thirdparty.createClient( user_info );
		var openid = req.__get.openid;
		
		// 调用公众号api获取目标用户的信息
		client.getUser(openid,function( err , follower ){
		
			res.setHeader('content-type','text/html');
			
			if(data.headimgurl){
				res.end('<img src="'+follower.headimgurl+'"/>');
			}else{
				res.end(follower.nickname + ' has no head img');
			}
			
		});
		 
	});
});
	
```

在授权事件接收URL的响应函数中调用save_ticket方法以刷新ticket：
```js
//首先在中间件里获取post的数据
'some_middleware' : function( req , res ){
	req.on( 'data' , function( d ){
		req.body += d.toString();
	});
};
// 然后在授权事件接受URL的响应函数中存储ticket
'auth_callback_action ': function( req , res ){
	thirdparty.save_ticket( req.body );
}
```

这个不加整个模块都没任何用处。。。

## 注意事项：

####本模块需要在两个server中分别调用:

**一个单进程的模块 或者 master进程** 用于向微信api拉取access\_token等私密信息，is\_cluster传false或者不传，这个server需要一直保持运行，不需要附加其他任何业务

其他的就是在实际server中用于处理业务请求的模块，这个只在cluster中启动, is\_cluster一定要传true，否则会导致token混乱，而且access_token拉取次数是有限制的，用完两个小时后所有业务就都歇菜了

####由于ticket是微信服务器向第三方平台推送的，所以每次重启server的时候都很难保证当前的ticket是否还有效

#####解决方案：
**重启server时先保证接收ticket的action正常**，在授权事件接收URL的处理函数中调用save\_ticket方法，10分钟之内就会收到微信的push请求

**这个过程中最好设置一个全局标志位置为false，然后所有worker进程监听该标志位，为false时停用所有和授权有关的功能，ticket更新后再将其置为true，worker监测到变化后启动授权业务，注：这个标志位不能放在内存变量中（多进程不共享内存的），需要入库或者写文件**

### 数据库建表语句：

Mysql：
```sql
/* 所有密钥及刷新时间 */
CREATE TABLE `component_secrets` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `ticket` varchar(255) DEFAULT NULL,
  `access_token` varchar(255) DEFAULT NULL,
  `preauthcode` varchar(255) DEFAULT NULL,
  `ticket_updated_at` bigint(20) DEFAULT NULL,
  `access_token_updated_at` bigint(20) DEFAULT NULL,
  `preauthcode_updated_at` bigint(20) DEFAULT NULL,
  `access_token_expires_in` int(64) DEFAULT NULL,
  `preauthcode_expires_in` int(64) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=27 DEFAULT CHARSET=utf8;

/* 第三方公众号信息 */
CREATE TABLE `wx_users_info` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `appid` varchar(255) DEFAULT NULL,
  `access_token` varchar(255) DEFAULT NULL,
  `access_token_updated_at` datetime DEFAULT NULL,
  `access_token_expires_in` datetime DEFAULT NULL,
  `refresh_token` varchar(255) DEFAULT NULL,
  `nick_name` varchar(255) DEFAULT NULL,
  `head_img` varchar(255) DEFAULT NULL,
  `service_type_id` int(11) DEFAULT NULL,
  `verify_type_info` varchar(255) DEFAULT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `alias` varchar(255) DEFAULT NULL,
  `wx_token` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=31 DEFAULT CHARSET=utf8;

/* 第三方公众号的听众列表 */
CREATE TABLE `wx_followers` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `openid` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `wx_token` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=44 DEFAULT CHARSET=utf8;

/* 听众用户信息 */
CREATE TABLE `wx_followers_info` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `subscribe` int(11) DEFAULT NULL,
  `openid` varchar(255) DEFAULT NULL,
  `nickname` varchar(255) DEFAULT NULL,
  `sex` int(11) DEFAULT NULL,
  `language` varchar(255) DEFAULT NULL,
  `city` varchar(255) DEFAULT NULL,
  `province` varchar(255) DEFAULT NULL,
  `country` varchar(255) DEFAULT NULL,
  `headimgurl` varchar(255) DEFAULT NULL,
  `subscribe_time` date DEFAULT NULL,
  `unionid` varchar(255) DEFAULT NULL,
  `remark` varchar(255) DEFAULT NULL,
  `groupid` int(11) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=35 DEFAULT CHARSET=utf8;
```
**TODO**: 
	1. 把bigint全改成date。。。存时间戳的理由已经被我忘了！
	2. 添加各个api的钩子记录各种信息，[钩子样例](https://github.com/windinsky/wxthirdparty/blob/master/lib/hooks/index.js)，这不是我一个人能干的活了。。
	3. 补注释，等休完年假回来再说
