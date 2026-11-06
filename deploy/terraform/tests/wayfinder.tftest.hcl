# Offline checks: nothing here talks to AWS. Providers are mocked, so these
# test what the configuration says, not what AWS does with it.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-southeast-2a", "ap-southeast-2b", "ap-southeast-2c"] }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  # The provider checks that ARNs look like ARNs, so the mocks supply one.
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:function/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-southeast-2:123456789012:loadbalancer/app/mock/0123456789abcdef" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-southeast-2:123456789012:listener/app/mock/0123456789abcdef/0123456789abcdef" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-southeast-2:123456789012:targetgroup/mock/0123456789abcdef" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:mock-AbCdEf" }
  }
  mock_resource "aws_secretsmanager_secret_version" {
    defaults = { secret_arn = "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:mock-AbCdEf" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::wayfinder-documents-123456789012" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-southeast-2:123456789012:log-group:mock" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/wayfinder/mock" }
  }
  mock_data "aws_elb_service_account" {
    defaults = { arn = "arn:aws:iam::783225319266:root" }
  }
  mock_data "aws_security_group" {
    defaults = { id = "sg-0123456789abcdef0" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

# The us-east-1 alias is the same provider, so it gets the same mocks.
mock_provider "aws" {
  alias = "us_east_1"
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/wayfinder/mock" }
  }
}

variables {
  # The migrate step calls the AWS CLI, which offline tests must not.
  run_migrations   = false
  image            = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/wayfinder@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  admin_seed_email = "admin@example.gov.au"
}

run "image_pinned_by_digest" {
  command = plan
  variables {
    image = "123456789012.dkr.ecr.ap-southeast-2.amazonaws.com/wayfinder:latest"
  }
  expect_failures = [var.image]
}

run "tasks" {
  command = apply

  assert {
    condition     = { for k, c in module.app.settings.containers : k => c.command } == { web = ["web"], api = ["api"], migrate = ["migrate"] }
    error_message = "One image, three commands: web, api and migrate."
  }
  assert {
    condition     = alltrue([for c in module.app.settings.containers : c.image == var.image])
    error_message = "Every task runs the pinned image."
  }
  assert {
    condition     = module.app.settings.containers.web.portMappings[0].containerPort == 3000 && !can(module.app.settings.containers.migrate.portMappings)
    error_message = "web listens on 3000; migrate listens on nothing."
  }
  assert {
    condition     = { for e in module.app.settings.containers.api.environment : e.name => e.value }["WEB_BASE_URL"] == "http://web:3000"
    error_message = "api reaches web for the scheduler heartbeat by its Service Connect name."
  }
  assert {
    condition     = { for e in module.app.settings.containers.web.environment : e.name => e.value }["BETTER_AUTH_URL"] == module.app.url && startswith(module.app.url, "https://")
    error_message = "BETTER_AUTH_URL is the https CloudFront URL, or sign-in callbacks break."
  }
  assert {
    condition = alltrue([
      for c in module.app.settings.containers :
      { for e in c.environment : e.name => e.value }["EMBEDDINGS_ALLOW_REMOTE_MODELS"] == "false" &&
      { for e in c.environment : e.name => e.value }["RUN_MIGRATIONS_ON_START"] == "false"
    ])
    error_message = "No remote model downloads, and migrations only from the migrate task."
  }
  assert {
    condition     = module.app.settings.health_path == "/"
    error_message = "web has no health route; / redirects to sign-in."
  }
}

run "secrets_not_in_environment" {
  command = apply

  assert {
    condition = alltrue([
      for n in ["DATABASE_URL", "SETTINGS_ENCRYPTION_KEY", "SCHEDULER_TICK_SECRET", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "AWS_BEDROCK_ACCESS_KEY_ID", "AWS_BEDROCK_SECRET_ACCESS_KEY"] :
      alltrue([
        for c in module.app.settings.containers :
        contains([for s in c.secrets : s.name], n) && !contains([for e in c.environment : e.name], n)
      ])
    ])
    error_message = "Every task gets its secrets from Secrets Manager, never plain environment values."
  }
  assert {
    condition     = contains([for s in module.app.settings.containers.web.secrets : s.name], "BETTER_AUTH_SECRET") && !contains([for s in module.app.settings.containers.api.secrets : s.name], "BETTER_AUTH_SECRET")
    error_message = "Only web signs sessions."
  }
  assert {
    condition = !anytrue(flatten([
      for c in module.app.settings.containers : [for e in c.environment : can(regex("SECRET|PASSWORD|_KEY$|_KEY_ID$|DATABASE_URL", e.name))]
    ]))
    error_message = "No secret-looking name may be a plain environment value."
  }
  assert {
    condition = (
      { for s in module.app.settings.containers.web.secrets : s.name => s.valueFrom }["MINIO_ACCESS_KEY"] == "${module.storage_user.secret_arn}:access_key_id::" &&
      { for s in module.app.settings.containers.web.secrets : s.name => s.valueFrom }["AWS_BEDROCK_SECRET_ACCESS_KEY"] == "${module.bedrock_user.secret_arn}:secret_access_key::"
    )
    error_message = "Key pairs are picked out of their users' JSON secrets."
  }
}

run "edge" {
  command = apply

  assert {
    condition     = module.app.settings.alb_internal && module.app.settings.uses_vpc_origin && module.app.settings.origin == "http-only"
    error_message = "The ALB is internal and reached through a VPC origin; the http hop stays in the VPC."
  }
  assert {
    condition     = module.app.settings.default_action.type == "fixed-response" && one(module.app.settings.default_action.fixed_response).status_code == "403"
    error_message = "Without CloudFront's header, the ALB answers 403."
  }
  assert {
    condition     = module.app.settings.access_logs[0].enabled
    error_message = "ALB access logs are on."
  }
  assert {
    condition     = module.app.settings.web_acl_id == module.waf.arn
    error_message = "The distribution is behind the WAF."
  }
  assert {
    condition     = length(module.app.settings.viewer_functions) == 1 && module.app.settings.viewer_functions[0].event == "viewer-request" && strcontains(module.app.settings.viewer_functions[0].code, "x-wayfinder-client-ip") && strcontains(module.app.settings.viewer_functions[0].code, "event.viewer.ip")
    error_message = "CloudFront writes the viewer address to x-wayfinder-client-ip, the header Better Auth rate-limits by."
  }
  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.referenced_security_group_id != null &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.cidr_ipv4 == null &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront.security_group_id == module.network.alb_security_group_id
    )
    error_message = "The ALB ingress rule admits CloudFront's VPC-origin group only."
  }
  assert {
    condition     = toset(module.network.rules.web_sources) == toset([module.network.rules.alb_sg, module.network.rules.api_sg])
    error_message = "web accepts the ALB and api only."
  }
  assert {
    condition     = toset(values(module.network.rules.database_sources)) == toset([module.network.rules.web_sg, module.network.rules.api_sg])
    error_message = "The database accepts web and api (and migrate, in api's group) only."
  }
}

run "waf" {
  command = apply

  assert {
    condition     = toset(module.waf.settings.sign_up_prefixes) == toset(["/register", "/api/auth/sign-up"])
    error_message = "Both ways to self-register are covered."
  }
  assert {
    condition     = one(module.waf.settings.rules["block-self-sign-up"].action).block != null && module.waf.settings.rules["block-self-sign-up"].priority == 0
    error_message = "Self sign-up is blocked, before any other rule."
  }
  assert {
    condition     = one(module.waf.settings.rules["rate-limit-sign-in"].action).block != null
    error_message = "Sign-in is rate limited."
  }
  assert {
    condition     = toset(keys(module.waf.settings.rules)) == toset(["block-self-sign-up", "rate-limit-sign-in", "aws-common", "aws-known-bad-inputs"])
    error_message = "Four rules: sign-up block, sign-in rate limit, and two AWS managed groups."
  }
}

run "data_at_rest" {
  command = apply

  assert {
    condition     = module.data.settings.encrypted && !module.data.settings.publicly_accessible && module.data.settings.engine_version == "16"
    error_message = "PostgreSQL 16, encrypted and private."
  }
  assert {
    condition = alltrue([
      module.storage.settings.public_access_block.block_public_acls,
      module.storage.settings.public_access_block.block_public_policy,
      module.storage.settings.public_access_block.ignore_public_acls,
      module.storage.settings.public_access_block.restrict_public_buckets,
    ])
    error_message = "The documents bucket is closed to the public."
  }
  assert {
    condition     = anytrue([for st in module.storage.settings.policy.Statement : st.Effect == "Deny" && st.Condition.Bool["aws:SecureTransport"] == "false"])
    error_message = "The documents bucket refuses plain HTTP."
  }
  assert {
    condition     = module.storage.settings.access_log_bucket == module.logging.s3_bucket
    error_message = "Access to the documents bucket is logged."
  }
  assert {
    condition = (
      length([for st in module.logging.settings.policies["s3"].Statement : st if st.Effect == "Allow" && try(st.Principal.Service, "") == "logging.s3.amazonaws.com" && st.Condition.StringEquals["aws:SourceAccount"] == "123456789012"]) == 1 &&
      length([for st in module.logging.settings.policies["cloudfront"].Statement : st if st.Effect == "Allow"]) == 0
    )
    error_message = "Only S3 log delivery for this account may write to the S3 access-log bucket."
  }
}

# The policies themselves, not a mocked policy document.
run "policies" {
  command = apply

  assert {
    condition = (
      length(module.app.settings.secrets_policy.Statement) == 1 &&
      module.app.settings.secrets_policy.Statement[0].Action == ["secretsmanager:GetSecretValue"] &&
      length(module.app.settings.secrets_policy.Statement[0].Resource) == 6 &&
      !anytrue([for r in module.app.settings.secrets_policy.Statement[0].Resource : strcontains(r, "*")])
    )
    error_message = "The execution role reads its six secrets and nothing else."
  }
  assert {
    condition = alltrue(flatten([
      for c in module.app.settings.containers : [
        for s in c.secrets : contains(module.app.settings.secrets_policy.Statement[0].Resource, trimsuffix(trimsuffix(trimsuffix(s.valueFrom, "::"), ":access_key_id"), ":secret_access_key"))
      ]
    ]))
    error_message = "Every secret a task asks for is readable by the execution role."
  }
  assert {
    condition = alltrue(flatten([
      for st in module.storage_user.settings.policy.Statement : [
        for r in st.Resource : r == module.storage.settings.bucket_arn || r == "${module.storage.settings.bucket_arn}/*"
      ]
    ])) && !contains(flatten([for st in module.storage_user.settings.policy.Statement : st.Action]), "s3:CreateBucket")
    error_message = "The storage user reaches the documents bucket and nothing else."
  }
  assert {
    condition = (
      length(module.bedrock_user.settings.policy.Statement) == 1 &&
      toset(module.bedrock_user.settings.policy.Statement[0].Action) == toset(["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]) &&
      alltrue([for r in module.bedrock_user.settings.policy.Statement[0].Resource : strcontains(r, "foundation-model/anthropic.") || strcontains(r, ":123456789012:inference-profile/")])
    )
    error_message = "The Bedrock user may only invoke Anthropic models and this account's inference profiles."
  }
}

# web rate-limits sign-in by the header CloudFront writes, and only web is told
# to trust it: api takes no inbound traffic.
run "client_ip_header" {
  command = apply

  assert {
    condition     = strcontains(module.app.settings.viewer_functions[0].code, "\"${ { for e in module.app.settings.containers.web.environment : e.name => e.value }["TRUSTED_CLIENT_IP_HEADER"]}\"")
    error_message = "web trusts exactly the header the CloudFront function writes."
  }
  assert {
    condition     = !anytrue([for c in [module.app.settings.containers.api, module.app.settings.containers.migrate] : contains([for e in c.environment : e.name], "TRUSTED_CLIENT_IP_HEADER")])
    error_message = "Only web, which serves sign-in, trusts a client-address header."
  }
  assert {
    condition = alltrue([
      for s in module.app.settings.containers.web.secrets :
      contains(module.app.settings.secrets_policy.Statement[0].Resource, split(":access_key_id::", split(":secret_access_key::", s.valueFrom)[0])[0])
    ])
    error_message = "The execution role can read every secret web asks ECS for."
  }
}
