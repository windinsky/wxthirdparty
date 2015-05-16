hooks = {
	// 示例：
	getUser: {
		before: function( openid , callback , temp_data ){
			// 调用getFollowers时的参数都会出现在这里，在这里可以选择直接入库
			// 如果需要等接口返回数据一起入库可以将数据记录在temp_data中
			// 不要直接修改temp_data,比如temp_data = open_id是不会生效的，类似amd中得exports
			// after调用时再将temp_data中的字段取出来入库
			// 例如：

			temp_data.openid = openid;
			callback();

			// 注：这只是做个示范，其实这个openid不需要记录，因为调用api返回的数据里还有openid
		
		},
		after: function( err , res_data , callback , temp_data ){

			if( err ) return callback( err );
			var that = this;
			var keys = ["subscribe", "openid", "nickname", "sex", "language", "city", "province", "country", "headimgurl", "subscribe_time", "unionid", "remark", "groupid"];
			// 获取temp_data中记录的openid
			var openid = temp_data.openid;
			
			// 与返回的信息一起入库，that.component就是全局的ThirtpartyServer实例
			that.component.models.write.WxFollowerInfo.find( { openid : openid } , 1 , function( err , user ){
				
				if( err ) return callback( err );

				if( user.length ){
					keys.forEach(function( k ){
						user[0][k] = res_data[k];
					});
					user[0].save(function(err){
						if( err ) return callback( err );
						callback( null , user[0] );
					});
				}else{
					res_data.openid = openid;
					res_data.created_at = new Date();
					that.component.models.write.WxFollowerInfo.create( res_data , function( err ){
						if( err ) return callback( err );
						callback( null , res_data );
					});
				}
			});
		
		}
	},
	// 获取所有关注的人的openid：
	getFollowers: {
		after: function( err , res_data , callback ){
			var followers = res_data.data.openid;
			var that = this;

			this.component.models.write.WxFollowers.create( followers.map( function( openid ){ 
				return {
					openid: openid,
					wx_token: that.user.wx_token
				};
			}) , function( err ){
				if( err ) callback( err );
			});

			callback( null , followers );
		}
	}
	
};




module.exports = hooks;
