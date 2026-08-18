-- Harvested display names that are an email address the row does not own.
-- Attacker-controlled free text stored as the label on a real address: #826
-- is the defect, #822 the send it caused. The row stays, only the claim goes.
UPDATE `address`
SET `display_name` = '',
    `normalized_compound` = `normalized_email`
WHERE `display_name` IS NOT NULL
  AND trim(`display_name`) GLOB '?*@?*.?*'
  AND trim(`display_name`) NOT GLOB '* *'
  AND length(trim(`display_name`)) - length(replace(trim(`display_name`), '@', '')) = 1
  AND lower(trim(`display_name`)) <> `normalized_email`;
