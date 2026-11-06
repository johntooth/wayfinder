variable "name" { type = string }

variable "policy" {
  description = "The user's only policy, as JSON."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
