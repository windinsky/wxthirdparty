var O		     = require('O');
var xml2js       = require('xml2js');
var orm          = require('orm');
var crypto       = require('crypto');
var Cryptor      = require('wechat-crypto');
var query        = require('./query');
var DB_SCHEMA    = require('./db_schema');
var EventEmitter = require('events').EventEmitter;
var util         = require('util');
var Client       = require('./Client');

const HOUR                  = 36e5;
const MINUTE                = 6e4;
const TICKET_VALID_DURATION = HOUR;

function ThirdpartyServer( component_appid , component_appsecret , token , encoding_aes_key , db_config , is_cluster){

	EventEmitter.call(this);
	
	if( !component_appid ) throw '第三方appid不能为空';
	if( !component_appsecret ) throw '第三方appsecret不能为空';
	if( !token ) throw 'Token不能为空';
	if( !encoding_aes_key ) throw 'EncodingAESKey不能为空';
	if( !db_config ) throw '没数据库配置搞毛啊';

	var that = this;

	// wx config
	this.component_appsecret = component_appsecret;
	this.component_appid     = component_appid;
	this.token               = token;
	this.encoding_aes_key    = encoding_aes_key;

	// db related
	this.db_config           = db_config;
	this.read_db             = null;
	this.write_db            = null;
	this.models              = { read:{}, write:{} };

	// status
	this.ticket_ready        = false;
	this.db_ready            = false;
	this.access_token_ready  = false;
	this.preauthcode_ready   = false;
	this.ready               = false;

	// utils
	this.crypto              = new Cryptor( this.token , this.encoding_aes_key , this.component_appid );

	// init
	this.set_db( db_config , function(){
		if( !is_cluster ){
			that.check_ticket();	
		}
	});

	// secrets
	if( !is_cluster ){
		this.ticket       = null;
		this.access_token = null;
		this.preauthcode  = null;
	}

	// last fetch time
	this.last_fetch_at = {
		access_token : null,
		ticket       : null,
		preauthcode  : null
	};

	// fail count
	this.get_access_token_fail_count = 0;
	this.get_preauthcode_fail_count  = 0;

	this.is_cluster = is_cluster;

};

util.inherits( ThirdpartyServer , EventEmitter );

ThirdpartyServer.prototype.createClient = function( appid , appsecret , token , expires_at ){

	return new Client(
		appid
		, appsecret
		, function( callback ){ callback( null , { accessToken: token, expireTime: expires_at }); }
		, function( token ){ callback(); }
	);

};

ThirdpartyServer.prototype.check_ready = function(){
	if( this.ready ) return true;
	if( this.db_ready && this.ticket_ready && this.preauthcode_ready && this.access_token_ready ){
		this.ready = true;
		return this.emit('ready');
	}
	return false;
};

ThirdpartyServer.prototype.fetch_user_info = function( auth_code , callback ){
	
	var that = this;
	var user_info = {
		wx_token: generateToken()
	};

	this.secrets( function(secret){
		query.post(
			'https://api.weixin.qq.com/cgi-bin/component/api_query_auth?component_access_token=' + secret.access_token,
			{
				"component_appid" : that.component_appid,
				"authorization_code": auth_code
			},
			function( err , auth_info ){

				if( err ) return callback( err );

				auth_info = JSON.parse( auth_info );
				if( auth_info.errcode ) return callback( auth_info );

				user_info.appid = auth_info.authorization_info.authorizer_appid;
				user_info.access_token = auth_info.authorization_info.authorizer_access_token;
				user_info.access_token_updated_at = new Date();
				user_info.access_token_expires_in = new Date(auth_info.authorization_info.expires_in*1000 + user_info.access_token_updated_at.getTime());
				user_info.refresh_token = auth_info.authorization_info.authorizer_refresh_token;

				query.post(
					'https://api.weixin.qq.com/cgi-bin/component/api_get_authorizer_info?component_access_token=' + secret.access_token,
					{
						"component_appid": that.component_appid,
						"authorizer_appid": user_info.appid
					},
					function( err , wx_info ){
						
						if( err ) return callback( err );

						wx_info = JSON.parse( wx_info );
						if( wx_info.errcode ) return callback( wx_info );

						user_info.nick_name        = wx_info.authorizer_info.nick_name;
						user_info.head_img         = wx_info.authorizer_info.head_img;
						user_info.service_type_id  = wx_info.authorizer_info.service_type_info.id;
						user_info.verify_type_info = wx_info.authorizer_info.verify_type_info;
						user_info.user_name        = wx_info.authorizer_info.user_name;
						user_info.alias            = wx_info.authorizer_info.alias;

						that.models.write.WxUserInfo.create( user_info , function( err , user ){
							
							if( err ) return callback( err );

							callback( null , user_info );

						});

					}
				)
			}
		)
	} );
};

function generateToken(){

	var t = new Date().getTime().toString().split(''),
		r = parseInt(Math.random()*1e10).toString().split(''),
		c = '';

	while( t.length || r.length ){
		c += t.shift() || '';
		c += r.shift() || '';
	}

	return md5(c);

}

ThirdpartyServer.prototype.get_user_info = function( wx_token , callback ){

	var that = this;

	that.models.read.WxUserInfo.find({ wx_token : wx_token },1,function(err , user){

		if( err ) return callback(err);

		if( user.length == 0 ) return callback( 'not exist' );

		if( user.access_token_updated_at + user.access_token_expires_in < new Date().getTime() ){
		
			return that.refresh_token( user.appid , user.refresh_token , function( err , token_info ){

				if( err ) return callback( err );

				token_info = JSON.parse( token_info );
				if( token_info.errcode ) return callback( token_info );
				
				user[0].access_token = token_info.authorizer_access_token;
				user[0].access_token_expires_in = token_info.expires_in;
				user[0].access_token_updated_at = new Date();
				user[0].refresh_token = token_info.authorizer_refresh_token;

				user[0].save( function( err ){
					
					if( err ) return callback( err );

					callback( null , user[0] );
				
				} );

			} );

		}

		callback( null , user[0] );
	
	});

};

ThirdpartyServer.prototype.refresh_token = function( appid , refresh_token , callback ){

	query.post(
		'https:// api.weixin.qq.com /cgi-bin/component/api_authorizer_token?component_access_token='+ this.access_token,
		{
			"component_appid":this.component_appid,
			"authorizer_appid":appid,
			"authorizer_refresh_token":refresh_token
		},
		callback
	);

};

function md5(val){
    var md5 = crypto.createHash('md5');
    md5.update(val);
    return md5.digest('hex');
};

ThirdpartyServer.prototype.secrets = function( callback ){
	
	var that = this;

	this.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){
	
		if( err ){
			callback( err );
			return that.emit('db_error');
		}

		if( !secret.length || !['ticket','access_token','preauthcode'].every( function(k){ return !!secret[0][k]; } ) ) {
			callback( 'not_ready' );
			return that.emit('not_ready');
		}

		var now = new Date().getTime();

		if( 
			// access_token已过期
			secret[0].access_token_updated_at + secret[0].access_token_expires_in*1000 < now ||
			// preauthcode已过期
			secret[0].preauthcode_updated_at + secret[0].preauthcode_expires_in*1000 < now ||
			// ticket已过期
			secret[0].ticket_updated_at + TICKET_VALID_DURATION < now
		){
			callback( 'outdated' );
			return that.emit('outdated');
		}

		secret = {
			ticket       : secret[0].ticket,
			preauthcode  : secret[0].preauthcode,
			access_token : secret[0].access_token
		}

		callback( secret );

		that.emit( 'end' , secret );

	});

	return that;

};

// 初始化数据库配置
ThirdpartyServer.prototype.set_db = function( config , callback ){

	var that = this;
	var read_db_ready = false , write_db_ready = false;

	function check_ready(){
		if( read_db_ready && write_db_ready ) {
			that.db_ready = true;
			typeof callback === 'function' && callback();
		}
	}
	
	orm.connect( config.write || config , function( err , db ){

		if(err) throw err;

		that.write_db = db;

		Object.keys( DB_SCHEMA ).forEach( function(klass){

			var schema = DB_SCHEMA[klass];

			that.models.write[klass] = that.write_db.define( schema.table , schema.columns , schema.options );

		});

		write_db_ready = true;

		check_ready();

	});

	orm.connect( config.read || config , function( err , db ){

		if(err) throw err;

		that.read_db = db;

		Object.keys( DB_SCHEMA ).forEach( function(klass){

			var schema = DB_SCHEMA[klass];

			that.models.read[klass] = that.read_db.define( schema.table , schema.columns , schema.options );

		});

		read_db_ready = true;

		check_ready();

	});

};

// 存储ticket
ThirdpartyServer.prototype.save_ticket = function(ticket_xml){

	var that = this;

	O.set(ticket_xml)
	 .then(xml2js.parseString)
	 .then(function(data){ return that.crypto.decrypt(data.xml.Encrypt[0]).message; })
	 .then(xml2js.parseString)
	 .then(function(result){
		var ticket = result.xml.ComponentVerifyTicket[0];
		var now = new Date().getTime();
		that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){
			if( err ){
				return console.log('读取数据库失败，无法写入ticket，请尽快检查服务器配置');
			}

			if( !secret.length ){
				return that.models.read.ComponentSecrets.create({
					ticket : ticket,
					ticket_updated_at : now
				}, function(err){
					if( err ){
						return console.log('写入数据库失败，无法写入ticket，请尽快检查服务器配置');
					}
				});
			}

			secret[0].ticket = ticket;
			secret[0].ticket_updated_at = now;
			secret[0].save( function( err ){
				if( err ){
					return console.log('写入数据库失败，无法写入ticket，请尽快检查服务器配置');
				}
			});
		});
	 });

};

ThirdpartyServer.prototype.start = function(){
	
	if( this.is_cluster ) return;

	var that = this;

	// 检查数据库
	if( !this.db_ready ) {
		console.log( 'db not ready. start over in 5 seconds' );
		return setTimeout( function(){
			that.start();
		}, 5e3 );
	};

	// 检查ticket
	if( !this.ticket_ready ){
		console.log( 'ticket not ready. start over in 5 seconds ' );
		this.check_ticket();
		return setTimeout( function(){
			that.start();
		}, 5e3 );
	}

	// 启动脚本刷新secrets
	this.refresh_secrets();

};

ThirdpartyServer.prototype.check_ticket = function(){

	var that = this;

	that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){

		if( err ) throw err;

		// ticket 每一个小时变化一次
		if( secret[0].ticket && new Date().getTime() - secret[0].ticket_updated_at < TICKET_VALID_DURATION ){
			that.ticket = secret[0].ticket;
			that.ticket_ready = true;
		}

	});

};

ThirdpartyServer.prototype.refresh_secrets = function(){
	
	var that = this;

	that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){
		
		if( err ) throw err;

		// 如果数据库里没有access_token和preauthcode，马上去获取
		if( !secret[0].access_token ){
			return that.get_access_token( function(){
				that.refresh_secrets();
			});
		}
		
		// 在access_token和preauthcode失效前一分钟重新获取
		if( secret[0].access_token ){
			
			that.last_fetch_at.access_token = secret[0].access_token_updated_at;

			if( !that.last_fetch_at.access_token ){
				return that.get_access_token( function(){
					that.refresh_secrets();
				})
			}

			that.access_token = secret[0].access_token;
			that.access_token_ready = true;
			that.check_ready();

			var timer = Math.max( that.last_fetch_at.access_token + secret[0].access_token_expires_in*1000 - new Date() - MINUTE );
			console.log('当前access_token仍然有效，'+parseInt(timer/1000)+'秒之后重新获取');
			setTimeout(
				function(){ that.get_access_token(); },
				timer
			);

		}

		if( !secret[0].preauthcode ){
			that.get_preauthcode();
		}

		if( secret[0].preauthcode ){
		
			that.last_fetch_at.preauthcode = secret[0].preauthcode_updated_at;

			if( !that.last_fetch_at.preauthcode ){
				return that.get_preauthcode();
			}

			that.preauthcode = secret[0].preauthcode;
			that.preauthcode_ready = true;
			that.check_ready();

			var timer = Math.max( that.last_fetch_at.preauthcode + secret[0].preauthcode_expires_in*1000 - new Date() - MINUTE);
			console.log('当前preauthcode仍然有效，'+parseInt(timer/1000)+'秒之后重新获取');

			setTimeout(
				function(){ that.get_preauthcode(); },
				timer
			);

		}

	});

};

ThirdpartyServer.prototype.get_access_token = function( callback ){

	var that = this;

	query.post(
		'https://api.weixin.qq.com/cgi-bin/component/api_component_token',
		{
			"component_appid"         : that.component_appid ,
			"component_appsecret"     : that.component_appsecret, 
			"component_verify_ticket" : that.ticket
		},
		function( err , data ){
			if( err ){
				that.get_access_token_fail_count++;
				if( that.get_access_token_fail_count >= 5 ){
					console.log(
						'刷新第三方access_token连续失败5次，为避免被微信封杀，停止尝试，可能有以下原因：\n'+
						'1.你服务器断网了\n'+
						'2.微信服务器瓦了\n'+
						'3.你的第三方平台账号被和谐了\n'+
						'4.你的授权回调接口歇菜了\n'+
						'为避免影响业务运行，请赶快排查，错误信息：'+err
					);
				}else{
					console.log( '刷新第三方access_token失败，尝试重新获取，错误信息：' , err );
				}
				setTimeout(function(){
					that.get_access_token();
				},3000);
				return ;
			}

			var now = new Date().getTime();

			data = JSON.parse(data);

			if(data.errcode) {
				that.get_access_token_fail_count++;
				if( that.get_access_token_fail_count >= 5 ){
					return console.log( '获取access_token连续失败5次，为避免被微信封杀，停止尝试，为避免影响业务运行，请赶快排查，错误信息：'+JSON.stringify(data));
				}else{
					console.log( '获取第三方access_token失败，错误信息：' + data + ',5秒钟后重试');
					setTimeout(function(){
						that.get_access_token();
					},5000);
				}
			}

			that.get_access_token_fail_count = 0;
			that.access_token = data.component_access_token;
			that.last_fetch_at.access_token = now;

			that.access_token_ready = true;
			that.check_ready();

			that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){
				secret[0].access_token = data.component_access_token;
				secret[0].access_token_updated_at = now;
				secret[0].access_token_expires_in = data.expires_in;
				secret[0].save( function( err ){
					if( err ){
						console.log('尝试将access_token写入数据库失败,在请尽快检查数据库配置');
					}
				});
			});
			typeof callback === 'function' && callback();
			var timer = data.expires_in - 60;
			console.log('获取access_token成功，' + timer + '秒后重新获取');
			setTimeout( function(){
				that.get_access_token()
			}, timer*1000);
		}
	);

};

ThirdpartyServer.prototype.get_preauthcode = function(){

	var that = this;
	
	query.post(
		'https://api.weixin.qq.com/cgi-bin/component/api_create_preauthcode?component_access_token=' + that.access_token,
		{
			"component_appid" : that.component_appid
		},
		function( err , data ){

			if( err ){
				that.get_preauthcode_fail_count++;
				if( that.get_preauthcode_fail_count >= 5 ){
					return console.log(
						'刷新preauthcode异常，可能有以下原因：\n'+
						'1.你服务器断网了\n'+
						'2.微信服务器瓦了\n'+
						'3.你的第三方平台账号被和谐了\n'+
						'4.你的获取ticket接口歇菜了\n'+
						'为避免影响业务运行，请赶快排查'
					);
				}else{
					console.log( '刷新preauthcode失败，尝试重新获取，错误信息：' , err );
				}
				return that.get_preauthcode();
			}

			var now = new Date().getTime();

			data = JSON.parse(data);
			if(data.errcode) return console.log(data);

			that.get_preauthcode_fail_count = 0;
			that.preauthcode = data.pre_auth_code;
			that.last_fetch_at.preauthcode = now;

			that.preauthcode_ready = true;
			that.check_ready();

			that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){

				secret[0].preauthcode            = data.pre_auth_code;
				secret[0].preauthcode_updated_at = now;
				secret[0].preauthcode_expires_in = data.expires_in;

				secret[0].save( function( err ){
					err && console.log('尝试将preauthcode写入数据库失败,在请尽快检查数据库配置');
				});

			});
			
			var timer = data.expires_in - 60;

			console.log('获取preauthcode成功，'+timer+'秒后重新获取');

			setTimeout(function(){
				that.get_preauthcode();
			}, timer*1000);
		}
	);

};


module.exports = ThirdpartyServer;
