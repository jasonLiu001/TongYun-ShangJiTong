/**
 * Created by wang on 2014/9/23.
 */
var Utility = require('../lib/Utility');
var utility = new Utility();
var DbConfigInfo = require('../Config');
var DbHelper = require('../lib/DbHelper');
var ConfigInfo = new DbConfigInfo();
var pool = new DbHelper(ConfigInfo.BusinessDB);
var async = require('async');
var soap=require('soap'),
    http=require('http'),
    path = require('path'),
    encryptor=require('../lib/Crypto.js'),
    secretKey=ConfigInfo.androidAppSettings.secretKey,//通云平台 加密解密 密钥
    appId=ConfigInfo.androidAppSettings.appId,
    SaasPlatformUrl=ConfigInfo.androidAppSettings.SaasPlatformUrl,//通云平台的webservice地址
    xmlReader=require('xmlreader');
var authentication=require('./authentication.js'),
    TokenVerification = require('./tokenVerification');

//业务库所有表
var businessDataTable={
    b_procurements:"b_procurements",
    b_procurements_key:"id",
    b_procurementsTags:"b_procurementstags",
    b_expositions:"b_expositions",
    b_expositions_key:"id",
    b_expositionsTags:"b_expositionstags",
    b_tags:"b_tags",
    b_user_mapping:"b_saas_usermapping"
};

//获取采购和展会列表信息
exports.getListInfo = function (req, res) {
    var sourceDataType = req.param("sourceDataType");

    GetTokenInformation(req, function (clientInfo) {
        executeGetListInfo(clientInfo,sourceDataType,req,res);
    });

    //executeGetListInfo(null,sourceDataType,req,res);
};

//执行采购及展会列表查询
function executeGetListInfo(clientInfo,sourceDataType,req,res) {
    var sqlParams = [];
    var bodyParams={};
    if(utility.isValidData(req.body.query)){
        bodyParams=typeof(req.body.query)=="object"?req.body.query:JSON.parse(req.body.query);
    }

    //收藏、今日
    var isFavoritesListInfo=req.query.isFavoritesListInfo,
        isTodayListInfo=req.query.isTodayListInfo;

    var pageSize;
    var pageIndex;
    if(utility.isValidData(req.query.startNum)){
        pageIndex=req.query.startNum;
    }
    if(utility.isValidData(bodyParams.startNum)){
        pageIndex=bodyParams.startNum;
    }
    if(utility.isValidData(req.query.count)){
        pageSize=req.query.count;
    }
    if(utility.isValidData(bodyParams.count)){
        pageSize=bodyParams.count;
    }

    var tagTable=businessDataTable.b_tags;
    var primaryTable;
    var primaryKey;
    var relationTable;
    var originType;
    var sqlPart="";

    switch (sourceDataType) {
        case "Procurement"://采购
            primaryTable=businessDataTable.b_procurements;
            primaryKey=businessDataTable.b_procurements_key;
            relationTable=businessDataTable.b_procurementsTags;
            originType = 2;
            sqlPart = "(select tag.TagText from b_tags tag left join  "+relationTable+" et on tag.id = et.TagId where et.EntityId = p.id and tag.TagType = 3 and tag.ParentTagId=0 LIMIT 1) as type, "
            + "(select tag.TagText from b_tags tag left join  "+relationTable+" et on tag.id = et.TagId where et.EntityId = p.id and tag.TagType = "+originType+" and tag.ParentTagId=0 LIMIT 1) as info ";
            break;
        case "Exposition"://展会
            primaryTable=businessDataTable.b_expositions;
            primaryKey=businessDataTable.b_expositions_key;
            relationTable=businessDataTable.b_expositionsTags;
            originType = 4;
            sqlPart = "(select tag.TagText from b_tags tag left join  "+relationTable+" et on tag.id = et.TagId where et.EntityId = p.id and tag.TagType = "+originType+" and tag.ParentTagId=0 LIMIT 1) as type ";
            break;
    }

    var sqlBasis = "select distinct p."+primaryKey+" as id,p.Title as title,p.Reference as sourceAddress,DATE_FORMAT(p.PublishDate, '%Y-%m-%d %H:%i:%s') as publishedDate," +
        "(select tag.TagText from b_tags tag left join  "+relationTable+" et on tag.id = et.TagId where et.EntityId = p.id and tag.TagType = 1 and tag.ParentTagId=0 LIMIT 1) as area,"+
        sqlPart+
        " from "+primaryTable+" p ";

    var sql = "select * from ("+sqlBasis+") temp where 1=1 ";

    var sqlWhere="";//where condition.

    //区域
    if(utility.isValidData(bodyParams.area)){
        sqlWhere += " and temp.area = ?";
        sqlParams.push(bodyParams.area);
    }
    if(utility.isValidData(bodyParams.publishedDate)){
        var day = parseInt(bodyParams.publishedDate);
        if(day){
            sqlWhere += " and temp.publishedDate>= date_add(DATE(NOW()), interval -"+day+" day)";
            sqlWhere += " and temp.publishedDate < date_add(DATE(NOW()), interval 1 day) ";
            //sqlParams.push(bodyParams.publishedDate);
        }
    }
    //采购类型
    if(utility.isValidData(bodyParams.infoType)){
        sqlWhere += " and temp.info = ?";
        sqlParams.push(bodyParams.infoType);
    }
    //采购品目
    if(utility.isValidData(bodyParams.itemType)){
        sqlWhere += " and temp.type = ?";
        sqlParams.push(bodyParams.itemType);
    }
    //展会行业
    if(utility.isValidData(bodyParams.industry)){
        sqlWhere+=" and temp.type= ?";
        sqlParams.push(bodyParams.industry);
    }
    //今日
    if(utility.isValidData(isTodayListInfo)){
        if(isTodayListInfo=="true"){
            sqlWhere+=" and to_days(now())-to_days(temp.publishedDate)=0 ";
        }
    }

    //收藏
    if(utility.isValidData(isFavoritesListInfo)){
        if(isFavoritesListInfo=="true" && clientInfo != null && clientInfo != false) {
            sqlWhere += " and temp.id in (select FavoritesId from favorites_user where UserId = '"+clientInfo.UserName+"' and Type = '"+sourceDataType+"') ";
        }
    }

    //总行数
    var queryCountSql = "select count(distinct temp.id) as count from ("+sqlBasis+") temp where 1=1 "+ sqlWhere;

    //总收藏数
   // var favoritesListCountSql="select count(distinct p."+primaryKey+") as count from "+primaryTable+" p " +
    //    " left join "+relationTable+" pt on p."+primaryKey+"=pt.EntityId " +
    //    " left join "+tagTable+" t on pt.TagId=t.id where 1=1 "+sqlWhere;

    var favoritesListCountSql = "select count(distinct id ) as count from favorites_user where Type = '"+sourceDataType+"'"

    var recommendParams = [];
    var recommendSql = "select * from recommend_where where UserId=?";
    var recommendCountSql = "select count(distinct temp.id) as count from ("+sqlBasis+") temp where 1=1 ";

    if (clientInfo != null && clientInfo != false) {
        favoritesListCountSql += " and UserId = '"+clientInfo.UserName+"'";
        recommendParams.push(clientInfo.UserName);
    }

    //今日总数
    var todayListCountSql="select count(distinct temp.id) as count from ("+sqlBasis+") temp where 1=1 "+sqlWhere+" and to_days(now())-to_days(temp.publishedDate)=0 ";

    sql += sqlWhere + " order by temp.publishedDate desc ";

    //分页操作
    if(utility.isValidData(pageIndex)&&utility.isValidData(pageSize)){
        sql += " limit ?,?";
        sqlParams.push(parseInt(pageIndex));
        sqlParams.push(parseInt(pageSize));
    }
    console.log(sql);

    //Get response data.
    getListInfoData(sql,sqlParams,queryCountSql,favoritesListCountSql,todayListCountSql,recommendSql,recommendCountSql,recommendParams,sourceDataType,res);
}

function getListInfoData(sql,sqlParams,queryCountSql,favoritesListCountSql,todayListCountSql,recommendSql,recommendCountSql,recommendParams,sourceDataType,res){
    //response data.
    var responseData={
        success:true,
        total:null,    //数据总数
        todayNum:null,  //今日
        recommendNum:null,//推荐
        favoritesNum:null,//收藏
        data:null,
        errorMsg:null
    };

    var recommendWhere ;

    async.series([
        function(callback){
            pool.ExecuteQuery(recommendSql, recommendParams,function(err,rows) {
                if (rows&&rows.length > 0) {
                    var where = null;
                    switch (sourceDataType) {
                        case "Exposition":
                            where = utility.isValidData(rows[0].Exposition_Where) ? rows[0].Exposition_Where : null;
                            break;
                        case "Procurement":
                            where = utility.isValidData(rows[0].Procurement_Where) ? rows[0].Procurement_Where : null;
                            break;
                    }

                    recommendWhere = typeof(where) == "string" ? JSON.parse(where) : where;
                }
                callback(err, rows);
            });
        },
        function(callback) {
            var params = [];
            var sqlWhere = "";

            if (recommendWhere) {
                if (utility.isValidData(recommendWhere.publishedDate)) {
                    var day = parseInt(recommendWhere.publishedDate);
                    if (day) {
                        sqlWhere += " and temp.publishedDate>= date_add(DATE(NOW()), interval -" + day + " day)";
                        sqlWhere += " and temp.publishedDate < date_add(DATE(NOW()), interval 1 day) ";
                    }
                }

                //区域
                if(utility.isValidData(recommendWhere.area)){
                    sqlWhere += " and temp.area = ?";
                    params.push(recommendWhere.area);
                }

                //采购品目
                if (utility.isValidData(recommendWhere.infoType)) {
                    sqlWhere += " and temp.info = ?";
                    params.push(recommendWhere.infoType);
                }
                //采购类型
                if (utility.isValidData(recommendWhere.itemType)) {
                    sqlWhere += " and temp.type = ?";
                    params.push(recommendWhere.itemType);
                }
                //展会行业
                if (utility.isValidData(recommendWhere.industry)) {
                    sqlWhere += " and temp.type= ?";
                    params.push(recommendWhere.industry);
                }

                recommendCountSql += sqlWhere;
            }

            pool.ExecuteQuery(recommendCountSql, params, function (err, rows) {
                if (rows && rows.length > 0) {
                    responseData.recommendNum = rows[0].count;
                }
                callback(err, rows);//总页数
            });
        },
        function(callback){
            pool.ExecuteQuery(sql, sqlParams,function(err,rows){
                responseData.data=rows;//详情信息
                callback(err, rows);
            });
        },
        function(callback){
            pool.ExecuteQuery(queryCountSql,sqlParams,function(err,rows){
                responseData.total=rows[0].count;
                callback(err, rows);//总页数
            });
        },
        function(callback){
            pool.ExecuteQuery(todayListCountSql,sqlParams,function(err,rows){
                responseData.todayNum=rows[0].count;
                callback(err, rows);//今日总数
            });
        },
        function(callback){
            pool.ExecuteQuery(favoritesListCountSql,sqlParams,function(err,rows){
                responseData.favoritesNum=rows[0].count;
                callback(err, rows);//收藏总数
            });
        }
    ],function(err,results){
        if (err) {
            console.error(err);
            responseData.success=false;
            responseData.errorMsg=err;
        }

        //if there is no errors,response to client.
        res.send(responseData);
    });
}

//采购和展会列表信息过滤
exports.filterListInfo = function (req, res) {
    var sourceDataType = req.param("sourceDataType");

    GetTokenInformation(req, function (clientInfo) {
        executeGetListInfo(clientInfo,sourceDataType,req,res);
    });

    //executeGetListInfo(null,sourceDataType,req,res);
};

//详情页信息
exports.getDetailInfo = function (req, res) {
    var sourceDataType = req.param("sourceDataType");

    GetTokenInformation(req, function (clientInfo) {
        executeGetDetailInfo(clientInfo,sourceDataType,req,res);
    });

    //executeGetDetailInfo(null,sourceDataType,req,res);
};

//执行详情信息查询
function executeGetDetailInfo(clientInfo,sourceDataType,req,res){
    var id=req.query.id;
    var sqlParams = [];

    var primaryTable;
    var primaryKey;

    switch (sourceDataType) {
        case "Procurement"://采购
            primaryTable=businessDataTable.b_procurements;
            primaryKey=businessDataTable.b_procurements_key;
            break;
        case "Exposition"://展会
            primaryTable=businessDataTable.b_expositions;
            primaryKey=businessDataTable.b_expositions_key;
            break;
    }

    var sql="select p."+primaryKey+" as id,p.Title as title,p.Reference as sourceAddress,DATE_FORMAT(p.PublishDate, '%Y-%m-%d %H:%i:%s') as publishedDate," +
        "(select (case when count(id)=0 then false else true end) from favorites_user where FavoritesId = p.id) as isFavorites"+
        ",p.RawContent as body from "+primaryTable+" p where 1=1 ";

    if(utility.isValidData(id)){
        sql+=" and p."+primaryKey+"=?";
        sqlParams.push(id);
    }

    console.log(sql);

    //Get response data.
    getDetailInfoData(sql, sqlParams,res);
}

function getDetailInfoData(sql,sqlParams,res){
    //response data.
    var responseData={
        success:true,
        data:null,
        errorMsg:null
    };

    async.series([
        function(callback){
            pool.ExecuteQuery(sql, sqlParams,function(err,rows){
                if(rows.length>0){
                    responseData.data = rows[0];
                }
                callback(err, rows);
            });
        }
    ],function(err,results){
        if (err) {
            console.error(err);
            responseData.success=false;
            responseData.errorMsg=err;
        }

        //if there is no errors,response to client.
        res.send(responseData);
    });
}

//信息搜索
exports.searchBusinessInfo = function (req, res) {
    var sourceDataType = req.param("sourceDataType");

    GetTokenInformation(req, function (clientInfo) {
        executeSearchBusinessInfo(clientInfo,sourceDataType,req,res);
    });

    //executeSearchBusinessInfo(null,sourceDataType,req,res);
};

// 执行信息搜索查询
function executeSearchBusinessInfo(clientInfo,sourceDataType,req,res){
    var sqlParams = [];
    var bodyParams={};
    if(utility.isValidData(req.body.query)){
        bodyParams=typeof(req.body.query)=="object"?req.body.query:JSON.parse(req.body.query);
}

    var pageIndex=bodyParams.startNum,
        pageSize=bodyParams.count;

    var tagTable=businessDataTable.b_tags;
    var primaryTable;
    var primaryKey;
    var relationTable;
    var originType;
    var sqlPart="";
    var showField="*";

    switch (sourceDataType) {
        case "Procurement"://采购
            primaryTable=businessDataTable.b_procurements;
            primaryKey=businessDataTable.b_procurements_key;
            relationTable=businessDataTable.b_procurementsTags;
            originType = 2;
            sqlPart = "(select tag.TagText from b_tags tag left join  "+relationTable+" et on tag.id = et.TagId where et.EntityId = p.id and tag.TagType = 3 and tag.ParentTagId=0 LIMIT 1) as info,"
            showField = "id,title,sourceAddress,publishedDate,area,info,type" ;
            break;
        case "Exposition"://展会
            primaryTable=businessDataTable.b_expositions;
            primaryKey=businessDataTable.b_expositions_key;
            relationTable=businessDataTable.b_expositionsTags;
            originType = 4;
            showField = "id,title,sourceAddress,publishedDate,area,type" ;
            break;
    }

    var sqlBasis = "select distinct p."+primaryKey+" as id,p.Title as title,p.Reference as sourceAddress,DATE_FORMAT(p.PublishDate, '%Y-%m-%d %H:%i:%s') as publishedDate," +
        "(select tag.TagText from b_tags tag left join  "+relationTable+" et on tag.id = et.TagId where et.EntityId = p.id and tag.TagType = 1 and tag.ParentTagId=0 LIMIT 1) as area,"+
        sqlPart+
        "(select tag.TagText from b_tags tag left join  "+relationTable+" et on tag.id = et.TagId where et.EntityId = p.id and tag.TagType = "+originType+" and tag.ParentTagId=0 LIMIT 1) as type "+
        ", p.RawContent as body from "+primaryTable+" p ";

    var sql = "select "+showField+" from ("+sqlBasis+") temp where 1=1 ";

    var sqlWhere="";

    //if (clientInfo != null && clientInfo != false) {
    //    sqlWhere += " and customer_name = ?";
    //    sqlParams.push(clientInfo.UserName);
    //}

    //查询关键字
    if(utility.isValidData(bodyParams.keyword)){
        sqlWhere +=" and (temp.title like('%" + bodyParams.keyword + "%') "+
            " or temp.body like('%" + bodyParams.keyword + "%') "+
            " or temp.area like('%" + bodyParams.keyword + "%') ";

            if(sourceDataType == "Procurement"){
                sqlWhere +=  "  or temp.info like('%" + bodyParams.keyword + "%') ";
            }

        sqlWhere+=  " or temp.type like('%" + bodyParams.keyword + "%')) ";
        //sqlParams.push(bodyParams.keyword);
    }

    sql += sqlWhere + "order by temp.publishedDate desc";

    //总行数
    var queryCountSql = "select count(temp.id) as count from ("+sqlBasis+") temp where 1=1 "+ sqlWhere;

    //分页操作
    if(utility.isValidData(pageIndex)&&utility.isValidData(pageSize)){
        sql += " limit ?,?";
        sqlParams.push(parseInt(pageIndex));
        sqlParams.push(parseInt(pageSize));
    }

    console.log(sql);

    getSearchBusinessInfoData(sql,sqlParams,queryCountSql,res);
}

function getSearchBusinessInfoData(sql,sqlParams,queryCountSql,res){
    //response data.
    var responseData={
        success:true,
        total:null,    //数据总数
        data:null,
        errorMsg:null
    };

    async.series([
        function(callback){
            pool.ExecuteQuery(sql, sqlParams,function(err,rows){
                responseData.data = rows;
                callback(err, rows);
            });
        },
        function(callback){
            pool.ExecuteQuery(queryCountSql,sqlParams,function(err,rows){
                responseData.total=rows[0].count;
                callback(err, rows);//总页数
            });
        }
    ],function(err,results){
        if (err) {
            console.error(err);
            responseData.success=false;
            responseData.errorMsg=err;
        }

        //if there is no errors,response to client.
        res.send(responseData);
    });
}

// 收藏保存
exports.operateFavorite=function(req,res){
    var sourceDataType = req.param("sourceDataType");

    GetTokenInformation(req, function (clientInfo) {
       executeOperateFavorite(clientInfo, sourceDataType, req, res);
    });

   // executeOperateFavorite(null, sourceDataType, req, res);
};

function executeOperateFavorite(clientInfo, sourceDataType, req, res){
    var sqlParams = [];
    var bodyParams={};
    if(utility.isValidData(req.body.query)){
        bodyParams=typeof(req.body.query)=="object"?req.body.query:JSON.parse(req.body.query);
    }

    //var sql="update "+primaryTable+" p set p.isFavorites=? where p."+primaryKey+"=?";
    var sql = "";
    var sqlIsHave = "select count(*) as count from favorites_user where FavoritesId = ? and UserId=? and Type = '"+sourceDataType+"'";

    if(utility.isValidData(bodyParams.action)){
       if(bodyParams.action=="add"){
           sql = "INSERT INTO favorites_user (FavoritesId,UserId,Type) VALUES (?,?,'"+sourceDataType+"')";
       }else if(bodyParams.action=="delete"){
           sql = "DELETE FROM favorites_user WHERE FavoritesId =? and UserId=? and Type = '"+sourceDataType+"'";
        }
    }
    if(utility.isValidData(bodyParams.id)){
        sqlParams.push(bodyParams.id);
    }

    if (clientInfo != null && clientInfo != false) {
        sqlParams.push(clientInfo.UserName);
    }

    console.log(sql);

    getOperateFavoriteData(sql,sqlIsHave,sqlParams,bodyParams.action,res);
}

function getOperateFavoriteData(sql,sqlIsHave,sqlParams,action,res){
    var responseData={
        success:true,
        errorMsg:null};

    var isHave = false;

    async.series([
        function(callback){
            pool.ExecuteQuery(sqlIsHave, sqlParams,function(err,rows){
                isHave = rows[0].count>0?true:false;
                callback(err, rows);
            });
        },
        function(callback){
            if(isHave && action == "add"){
                sql = "select id from  favorites_user LIMIT 0"
            }

            pool.ExecuteQuery(sql, sqlParams,function(err,rows){
                callback(err, rows);
            });
        }
    ],function(err,results){
        if (err) {
            console.error(err);
            responseData.success=false;
            responseData.errorMsg=err;
        }

        //if there is no errors,response to client.
        res.send(responseData);
    });
}

function GetTokenInformation(req, next) {
    var clientInfo = req.cookies.clienttoken //点击了记住我
        //|| req.session.AuthenticationToken//未点击记住我
        || req.headers.authentication;//来自Mobile

    if (typeof(clientInfo) == 'object') {
        next(clientInfo);
    }
    else if (typeof (clientInfo) == "string") {
        TokenVerification.GetUserInformationByToken(clientInfo, function (isFetch, clientInfo) {
            if (isFetch) {
                next(clientInfo);
            }
        });
    }
}

exports.getTags = function(req,res){
    //GetTokenInformation(req, function (clientInfo) {
    //    executeGetTags(clientInfo,req,res);
   //});

    executeGetTags(null,req,res);
}

function executeGetTags(clientInfo,req,res){

    var sqlArea = "select id,TagText from b_tags where TagType=1 and ParentTagId = 0",
        sqlType = "select id,TagText from b_tags where TagType=2 and ParentTagId = 0",
        sqlOrigins = "select id,TagText from b_tags where TagType=3 and ParentTagId = 0",
        sqlTrade = "select id,TagText from b_tags where TagType=4 and ParentTagId = 0";

    var sqlParams = [];

    getTagsData(sqlArea,sqlType,sqlOrigins,sqlTrade,sqlParams,res);
}

function getTagsData(sqlArea,sqlType,sqlOrigins,sqlTrade,sqlParams,res) {
    var responseData = {
        success: true,
        data: {areas: null, types: null, origins: null, trades: null},
        errorMsg: null};

    async.series([
        function (callback) {
            pool.ExecuteQuery(sqlArea, sqlParams, function (err, rows) {
                responseData.data.areas = rows;
                callback(err, rows);
            });
        },
        function (callback) {
            pool.ExecuteQuery(sqlType, sqlParams, function (err, rows) {
                responseData.data.types = rows;
                callback(err, rows);
            });
        },
        function (callback) {
            pool.ExecuteQuery(sqlOrigins, sqlParams, function (err, rows) {
                responseData.data.origins = rows;
                callback(err, rows);
            });
        },
        function (callback) {
            pool.ExecuteQuery(sqlTrade, sqlParams, function (err, rows) {
                responseData.data.trades = rows;
                callback(err, rows);
            });
        }
    ], function (err, results) {
        if (err) {
            console.error(err);
            responseData.success = false;
            responseData.data = null;
            responseData.errorMsg = err;
        }

        //if there is no errors,response to client.
        res.send(responseData);
    });
}

exports.getRecommendWhere=function(req,res){
    GetTokenInformation(req, function (clientInfo) {
        executeGetRecommendWhere(clientInfo,req,res);
    });

    //executeGetRecommendWhere(null,req,res);
}

function executeGetRecommendWhere(clientInfo,req,res)
{
    var sqlParams = [];
    var bodyParams={};

    var sql = "select * from recommend_where where UserId=?";

    if (clientInfo != null && clientInfo != false) {
        sqlParams.push(clientInfo.UserName);
    }

    getRecommendWhereData(sql,sqlParams,res);
}

function getRecommendWhereData(sql,sqlParams,res)
{
    var responseData = {
        success: true,
        data: {expositionWhere:null,procurementWhere:null},
        errorMsg: null};

    async.series([
        function (callback) {
            pool.ExecuteQuery(sql, sqlParams, function (err, rows) {
                if(rows.length>0) {
                    var whereExposition = JSON.parse(rows[0].Exposition_Where || "{}");
                    var whereProurement = JSON.parse(rows[0].Procurement_Where || "{}");

                    responseData.data.expositionWhere = {
                        area: whereExposition.area || "",
                        publishedDate: whereExposition.publishedDate || "",
                        industry: whereExposition.industry || ""
                    }

                    responseData.data.procurementWhere = {
                        area: whereProurement.area || "",
                        publishedDate: whereProurement.publishedDate || "",
                        infoType: whereProurement.infoType || "",
                        itemType: whereProurement.itemType || ""
                    }
                }

                callback(err, rows);
            });
        }
    ], function (err, results) {
        if (err) {
            console.error(err);
            responseData.success = false;
            responseData.data = null;
            responseData.errorMsg = err;
        }

        //if there is no errors,response to client.
        res.send(responseData);
    });
}

exports.saveRecommendWhere=function(req,res){
    var sourceDataType = req.param("sourceDataType");

    GetTokenInformation(req, function (clientInfo) {
        executeSaveRecommendWhere(clientInfo,sourceDataType,req,res);
    });

    //executeSaveRecommendWhere(null,sourceDataType,req,res);
}

function executeSaveRecommendWhere(clientInfo,sourceDataType,req,res)
{
    var sqlParams = [];
    var sqlIsHaveParams = [];
    var bodyParams={};
    if(utility.isValidData(req.body.query)){
        bodyParams=typeof(req.body.query)=="object"?req.body.query:JSON.parse(req.body.query);
    }

    //bodyParams = JSON.stringify(bodyParams);

    var whereField = "";
    var where=null;

    switch (sourceDataType) {
        case "Exposition":
            whereField = "Exposition_Where";
            if(utility.isValidData(bodyParams)) {
                where = {
                    area: bodyParams.area || "",
                    publishedDate: bodyParams.publishedDate || "",
                    industry: bodyParams.industry || ""
                }
            }
            break;
        case "Procurement":
            whereField = "Procurement_Where";
            if(utility.isValidData(bodyParams)) {
                where = {
                    area: bodyParams.area || "",
                    publishedDate: bodyParams.publishedDate || "",
                    infoType: bodyParams.infoType || "",
                    itemType: bodyParams.itemType || ""
                }
            }
            break;
    }
    var where = JSON.stringify(where);

    var sqlIsHave ="select COUNT(id) as count from recommend_where where UserId=?";

    var sqlInsert = "Insert into recommend_where ("+whereField+",UserId) values(?,?)";
    var sqlUpdate = "update recommend_where set "+whereField+" = ? where UserId= ?";

    if(utility.isValidData(where))
    {
        sqlParams.push(where);
    }

    if (clientInfo != null && clientInfo != false) {
        sqlParams.push(clientInfo.UserName);
        sqlIsHaveParams.push(clientInfo.UserName);
    }

    saveRecommendWhereData(sqlInsert,sqlUpdate,sqlIsHave,sqlParams,sqlIsHaveParams,res);
}

function saveRecommendWhereData(sqlInsert,sqlUpdate,sqlIsHave,sqlParams,sqlIsHaveParams,res){
    var responseData = {
        success: true,
        errorMsg: null};
    var isHave = false;

    async.series([
        function (callback) {
            pool.ExecuteQuery(sqlIsHave, sqlIsHaveParams, function (err, rows) {
                isHave = rows[0].count>0?true:false;
                callback(err, rows);
            });
        },
        function (callback) {
            var sql = sqlInsert;
            if(isHave){
                sql = sqlUpdate;
            }

            pool.ExecuteQuery(sql, sqlParams, function (err, rows) {
                callback(err, rows);
            });
        }
    ], function (err, results) {
        if (err) {
            console.error(err);
            responseData.success = false;
            responseData.errorMsg = err;
        }

        //if there is no errors,response to client.
        res.send(responseData);
    });
}

exports.getRecommendListInfo=function(req,res){
    var sourceDataType = req.param("sourceDataType");

    GetTokenInformation(req, function (clientInfo) {
        executeRecommendListInfo(clientInfo,sourceDataType,req,res);
    });

    //executeRecommendListInfo(null,sourceDataType,req,res);
};

function executeRecommendListInfo(clientInfo,sourceDataType,req,res){
    var sourceDataType = req.param("sourceDataType");
    var sql = "select * from recommend_where where UserId=?";
    var sqlParams = [];
    var pageIndex=0;
    var pageSize=10;

    if(utility.isValidData(req.query.startNum)){
        pageIndex=req.query.startNum;
    }
    if(utility.isValidData(req.query.count)){
        pageSize=req.query.count;
    }

    //response data.
    var responseData={
        success:true,
        total:null,    //数据总数
        todayNum:null,  //今日
        recommendNum:null,//推荐
        favoritesNum:null,//收藏
        data:null,
        errorMsg:null
    };

    if (clientInfo != null && clientInfo != false) {
        sqlParams.push(clientInfo.UserName);
    }

    async.waterfall([
        function (callback) {
            pool.ExecuteQuery(sql, sqlParams, function (err, rows) {
                if(err){
                    callback(err, null);
                }else{
                    callback(null, rows);
                }
            });
        }
    ], function (err, result) {
        if (err) {
            console.error(err);
            responseData.success=false;
            responseData.errorMsg=err;
            res.send(responseData);
        }else if(result.length>0)
        {
            switch (sourceDataType) {
                case "Procurement"://采购
                    var procurementWhere = JSON.parse(result[0].Procurement_Where);
                    procurementWhere.startNum = pageIndex;
                    procurementWhere.count = pageSize;
                    req.body.query = procurementWhere;
                    executeGetListInfo(clientInfo, sourceDataType, req, res);
                    break;
                case "Exposition"://展会
                    var expositionWhere = JSON.parse(result[0].Exposition_Where);
                    expositionWhere.startNum = pageIndex;
                    expositionWhere.count = pageSize;
                    req.body.query = expositionWhere;
                    executeGetListInfo(clientInfo, sourceDataType, req, res);
                    break;
            }
        }else{
             responseData={
                success:true,
                recommendNum:0,//推荐
                data:[],
                errorMsg:null
            };
            res.send(responseData);
        }
    });
}

exports.downloadAPK = function(req,res){
    res.download(path.resolve('./BizOpps.apk'));
}

//登录
exports.login=function(req,res){
   //本地用户与通云平台集成认证
   //integratedAuth(req,res);

    //只进行本地用户认证
    nativeAuth(req, res);
};

/**
*
 * @summary 只进行本地用户认证
* */
function nativeAuth(req,res){
    authentication.ApiLogin(req, res);
}

/**
*
 * @summary 本地用户与通云平台用户集成认证
* */
function integratedAuth(req,res){
    var bodyParams={};
    var userName='';
    var userPwd='';

    if(typeof(req.body.query)!=="object"){
        var errorMsg="Error Message:The post data must be an json object.";
        console.log(errorMsg);
        return res.send({loginStatus:0,errorMsg:errorMsg});//通云平台验证失败
    }

    if(utility.isValidData(req.body.query)){
        bodyParams=req.body.query;
    }

    if(utility.isValidData(bodyParams.userName)){
        userName=bodyParams.userName;
    }
    if(utility.isValidData(bodyParams.userPwd)){
        userPwd=encryptor.MD5(bodyParams.userPwd);
    }
    //登录接口请求消息体
    var reqHeader = GetRequestHeader("SYS00003");
    var reqBody = "<SIID></SIID><AppID>"+appId+"</AppID><UserType>0</UserType><Username>"+userName+"</Username><Password>" +userPwd+ "</Password>";
    var reqMsg = GetRequestMessage(reqHeader, reqBody);

    var args = {requestXML: reqMsg};

    async.waterfall([
        function(callback){
            soap.createClient(SaasPlatformUrl, function (err, client) {
                //调用通云平台鉴权接口
                client.execute(args, function (err, result) {
                    if(err){
                        callback(err,null);
                    }else{
                        callback(null,result);
                    }
                });
            });
        },
        function(arg1,callback){
            if(arg1){
                if (arg1.executeReturn) {
                    var xmlString = arg1.executeReturn;
                    //解析通云平台接口返回信息
                    xmlReader.read(xmlString, function (err, xmlDoc) {
                        if(err){
                            callback(err, null);
                        }else{
                            //通云平台消息体
                            var resBody = xmlDoc.Msg.Body.text();
                            //移除字符串中所有的换行符
                            resBody = resBody.replace(/\n/g, '');
                            resBody = encryptor.decryptSSOPlain(resBody, secretKey);
                            callback(null, resBody);
                        }
                    });
                }
            }else{
                callback(new Error('There is no data,response from the SaaS Platform!'),null);
            }
        },
        function(arg1,callback){
            if(arg1){
                xmlReader.read(GetXmlMessage(arg1), function (err, resultXml) {
                    if(err){
                        callback(err, null);
                    }else{
                        callback(null, resultXml);
                    }
                });
            }else{
                callback(new Error('The body of the SaaS Platform response message is empty!'),null);
            }
        }
    ],function(err,result){
        if (err) {
            console.error(err);
            return res.send(err);
        }

        var body = result.Msg.Body;
        var resultDesc = body.ResultDesc.text();//请求结果
        var resultCode=body.ResultCode.text();//请求代码
        if (resultCode === "0000") {//通云平台验证成功
            //企业客户Id
            var EcID=body.EcID.text();//企业客户或成员Id
            req.body.query.EcID=EcID;//添加到查询参数
            authentication.androidLogin(req, res);//关联本地用户并登录
        }else{
            console.log("Error Message:"+resultDesc);
            return res.send({loginStatus:0,errorMsg:resultDesc});//通云平台验证失败
        }
    });
}

//注销
exports.logout=function(req,res){
    var currentToken = req.headers.authentication || false;
    if (currentToken) {
        TokenVerification.DeleteToken(currentToken, function (err, affectRowCount) {
            if (err) {
                console.log('Authentication Logout Error: ' + err.message);
                res.send({success:false,errorMsg:err});
                return;
            }
            if (affectRowCount == 1) {
                console.log('Authentication Logout Success(Token Deleted from DB!)');
            }
            try {
                //req.session.AuthenticationToken = null;
                req.signedCookies.AuthenticationToken = null;
                res.clearCookie('AuthenticationToken');
                console.log('Authentication Logout Success(Token Deleted from cookie!)');
                res.send({success:true,token:null});
                return;
            }
            catch (ex) {
                console.log('Authentication Logout Exception: ' + ex);
                res.send({success:false,errorMsg:ex});
                return;
            }
        });
    }
    else {
        res.send({success:true,token:null});
    }
};

//生成请求头
function GetRequestHeader(code) {
    var header="<Code>" + code + "</Code><CTID></CTID><AppID>"+appId+"</AppID><SubmitTime></SubmitTime><Version></Version><Priority></Priority>";
    return header;
}

//生成客户端请求消息
function GetRequestMessage(reqHeader, reqBody) {
    reqBody=encryptor.encryptSSOPlain(reqBody,secretKey);
    var msg="<?xml version=\"1.0\" encoding=\"UTF-8\"?><Msg><Head>" + reqHeader + "</Head><Body>" + reqBody + "</Body></Msg>";
    return msg;
}

function GetXmlMessage(msg){
    var msg="<?xml version=\"1.0\" encoding=\"UTF-8\"?><Msg><Body>"+msg+"</Body></Msg>";
    return msg;
}