variable "name" { type = string }

variable "sign_in_rate_limit" {
  description = "Sign-in requests one IP may make in five minutes before it is blocked."
  type        = number
  default     = 100
}

variable "tags" {
  type    = map(string)
  default = {}
}
