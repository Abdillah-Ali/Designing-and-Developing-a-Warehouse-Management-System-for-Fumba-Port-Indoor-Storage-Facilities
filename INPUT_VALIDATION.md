# Contact and registration input rules

Cargo registration, user creation/editing, initial administrator setup and profile contact editing enforce contact formats on the server. The corresponding forms use the same contact rules. Regression tests keep the browser and server validator copies identical.

- **Phone:** Tanzania local numbers must contain 10 digits starting with 02, 06 or 07. Equivalent 255 and +255 formats are accepted. Other international contacts must start with + and contain 8–15 digits, starting with a nonzero country code. Single spaces or hyphens between digit groups are accepted. Examples: `0751234567`, `+255 751 234 567`, `+442079460958`. Letters, misplaced plus signs, repeated separators and incorrect Tanzanian lengths are rejected. Payment network validation remains separate.
- **Email:** Maximum 150 characters, maximum 64 before @, one @, a dotted domain, valid domain labels, and no leading, trailing or consecutive dots in the local part. Ordinary ASCII addresses, plus tags and subdomains are supported. Quoted local parts and internationalized Unicode email addresses are not supported.
- **Cargo amounts:** Quantity, weight and volume must be positive decimal values, at most 9,999,999,999.99, with at most two decimal places. This matches the database columns. Booleans, arrays, exponent notation and hexadecimal notation are rejected. Fractional quantities remain supported.
- **Cargo text:** Names are limited to 150 characters; other short fields follow their database limits. Descriptions and inspection notes are limited to 5,000 characters. Structured objects and unsupported control characters are rejected.
- **User:** Full name is 2–150 characters. Username is 3–50 characters using letters, digits, dots, underscores or hyphens. Passwords require at least eight characters, uppercase, lowercase, a digit and a special character, with a maximum of 72 UTF-8 bytes to avoid bcrypt truncation. Passwords are preserved without trimming during user creation/editing.

Existing server checks still enforce required and conditional cargo fields, catalog choices, user roles, warehouse/shift assignments, account status and username/email uniqueness. Email remains optional for cargo when its configuration permits it.

Format validation does not verify that a contact exists or belongs to the person entering it. Existing stored records are not rewritten; invalid contact values need correcting when those records are edited.
