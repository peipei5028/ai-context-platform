# ai-context

查询 AI CODING 上下文管理平台的项目信息、接口链路和影响分析。

## 使用方式

用户输入 `/ai-context` 后，根据用户的自然语言描述，调用对应 API 完成查询。

所有 API 需要认证。先登录获取 token：

```bash
TOKEN=$(curl -s -X POST $BASE_URL/auth/login -H 'Content-Type: application/json' -d '{"username":"xxx","password":"xxx"}' | jq -r '.token')
```

后续请求携带 `Authorization: Bearer $TOKEN`。

## 可用操作

通过 curl 调用 REST API (BASE_URL: http://localhost:8000/api/v1):

### 认证
- **登录**: curl -X POST $BASE_URL/auth/login -H 'Content-Type: application/json' -d '{"username":"xxx","password":"xxx"}'
- **当前用户**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/auth/me

### 系统与APP
- **查看系统列表**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/systems
- **查看系统详情(含APP列表)**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/systems/{id}
- **查看APP详情**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}

### 索引
- **触发索引**: curl -X POST -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/index -H 'Content-Type: application/json' -d '{"include_wiki":true}'
- **查看索引状态**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/index/status

### 查询
- **获取接口路由**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/routes
- **影响分析**: curl -X POST -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/impact -H 'Content-Type: application/json' -d '{"target":"POST /api/v1/payment","direction":"both","depth":3}'
- **代码搜索**: curl -X POST -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/search -H 'Content-Type: application/json' -d '{"query":"支付处理","mode":"hybrid","limit":20}'
- **获取Wiki目录**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/wiki
- **获取Wiki模块内容**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/wiki/{module}
- **跨仓库读源码**: curl -X POST -H "Authorization: Bearer $TOKEN" $BASE_URL/code/read -H 'Content-Type: application/json' -d '{"items":[{"app_id":"app-payment","ref":"main","path":"src/service/PaymentService.java","start_line":1,"end_line":200}],"max_bytes_per_file":65536}'

### 文档
- **系统文档列表**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/systems/{id}/documents
- **APP文档列表**: curl -H "Authorization: Bearer $TOKEN" $BASE_URL/apps/{id}/documents
- **下载文档**: curl -H "Authorization: Bearer $TOKEN" -O $BASE_URL/documents/{doc_id}/download

## 行为规则

1. 先了解用户要查询的系统/APP，必要时先列出系统列表
2. 查询结果以结构化方式呈现给用户
3. 影响分析结果应包含风险等级、受影响范围和测试建议
4. Wiki 内容包含 Mermaid 架构图，直接渲染给用户
5. 如果 APP 未索引（index_status=none），提示用户先触发索引
6. 跨仓库读源码支持批量读取多个 APP 的文件，可通过 start_line/end_line 指定行号范围，适合定位具体代码片段
7. 读源码时先通过查看系统列表或APP详情获取 app_id，再按路径读取，结果中包含 resolved_commit 用于溯源
