hooks = {
	// 示例：
	getFollowers: {
		before: function(callback){
		},
		after: function( err , data , callback ){
			var followers = data.data.openid;
			var that = this;

			this.component.models.write.WxFollowers.create( followers.map(function(openid){ 
				return {
					openid: openid,
					wx_token: that.user.wx_token
				};
			}) , function( err ){
				if(err) callback( err );
			});

			callback( null , followers );
		}
	},
	getUser: {
		before: function( openid , callback , temp_data ){
			// 你调用getFollowers时的参数都会出现在这里，在这里可以选择直接入库
			// 如果需要等接口返回数据一起入库可以在temp_data里记录需要的信息
			// 不要直接修改temp_data,比如temp_data = open_id是不会生效的，类似amd中得exports
			// after调用时再将temp_data中的字段取出来入库
			// 例如：

			temp_data.openid = openid;
			callback();

			// 注：这只是做个示范，其实这个openid不需要记录，因为调用api返回的数据里还有openid
		
		},
		after: function( err , data , callback , temp_data ){
			// 入库后一定要记得将该属性删除，避免下次调用出错
			// this.__followers_record = null;
			// delete this.__followers_record;

			if( err ) return callback( err );
			var that = this;
			var keys = ["subscribe", "openid", "nickname", "sex", "language", "city", "province", "country", "headimgurl", "subscribe_time", "unionid", "remark", "groupid"];
			var openid = temp_data.openid;

			that.component.models.write.WxFollowerInfo.find({openid:openid},1,function( err , user ){
				
				if( err ) return callback( err );

				if( user.length ){
					keys.forEach(function(k){
						user[0][k] = data[k];
					});
					user[0].save(function(err){
						if( err ) return callback( err );
						callback( null , user[0] );
					});
				}else{
					data.openid = openid;
					data.created_at = new Date();
					that.component.models.write.WxFollowerInfo.create(data,function( err ){
						if( err ) return callback( err );
						callback( null , data );
					});
				}
			});
		
		}
	}
};




module.exports = hooks;
