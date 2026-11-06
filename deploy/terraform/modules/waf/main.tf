# The web ACL in front of wayfinder's CloudFront distribution. CloudFront-scope
# ACLs live in us-east-1, so the root module passes this module that provider.
#
# wayfinder lets anyone who reaches it register. Here accounts are made by an
# admin instead (Admin > Users, then a password reset), which goes through the
# app's own API rather than the sign-up endpoint, as does the first-run setup.
# So the edge refuses self sign-up outright.

locals {
  # Paths are normalised, decoded and lower-cased before matching, so
  # //Register or /api/auth/%73ign-up do not slip past.
  path_transformations = ["NORMALIZE_PATH", "URL_DECODE", "LOWERCASE"]

  sign_up_prefixes = ["/register", "/api/auth/sign-up"]
}

resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "block-self-sign-up"
    priority = 0
    action {
      block {}
    }
    statement {
      or_statement {
        dynamic "statement" {
          for_each = local.sign_up_prefixes
          content {
            byte_match_statement {
              search_string         = statement.value
              positional_constraint = "STARTS_WITH"
              field_to_match {
                uri_path {}
              }
              dynamic "text_transformation" {
                for_each = local.path_transformations
                content {
                  priority = text_transformation.key
                  type     = text_transformation.value
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-block-self-sign-up"
      sampled_requests_enabled   = true
    }
  }

  # Per client IP, over a five-minute window.
  rule {
    name     = "rate-limit-sign-in"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.sign_in_rate_limit
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/auth/sign-in"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            dynamic "text_transformation" {
              for_each = local.path_transformations
              content {
                priority = text_transformation.key
                type     = text_transformation.value
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit-sign-in"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Document and template uploads are larger than the rule's 8 KB body
        # limit, so it only counts.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }

  tags = var.tags
}
