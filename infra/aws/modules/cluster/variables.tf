variable "project_name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "certificate_arn" {
  description = "ACM wildcard certificate for *.<base_domain> (required — ADR-034 Decision 3)"
  type        = string
}
