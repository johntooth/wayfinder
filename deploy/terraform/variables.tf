variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "name" {
  type    = string
  default = "wayfinder"
}

variable "tags" {
  type    = map(string)
  default = { Project = "wayfinder" }
}

variable "image" {
  description = "<account>.dkr.ecr.<region>.amazonaws.com/wayfinder@sha256:..., built with VENDOR_EMBEDDINGS_MODEL=true."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "Pin the image by digest."
  }
}

variable "admin_seed_email" {
  description = "Only this address may create the first admin on /setup."
  type        = string
}

variable "bedrock_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "run_migrations" {
  description = "Run the migrate task before web and api roll out whenever its task definition changes (needs the AWS CLI where Terraform runs). Off only for offline tests."
  type        = bool
  default     = true
}
