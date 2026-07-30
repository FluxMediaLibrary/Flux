-- Preserve selections from Flux's original inline vector set under their new
-- stable local-file ids.
UPDATE "profiles"
SET "avatar" = CASE "avatar"
  WHEN 'robot' THEN 'flux-robot'
  WHEN 'astronaut' THEN 'flux-astronaut'
  WHEN 'cat' THEN 'flux-cat'
  WHEN 'fox' THEN 'flux-fox'
  WHEN 'ghost' THEN 'flux-ghost'
  WHEN 'alien' THEN 'flux-alien'
  WHEN 'ninja' THEN 'flux-void-mask'
  WHEN 'panda' THEN 'flux-panda'
  WHEN 'bear' THEN 'flux-bear'
  WHEN 'owl' THEN 'flux-owl'
  WHEN 'frog' THEN 'flux-frog'
  WHEN 'penguin' THEN 'flux-penguin'
  ELSE "avatar"
END
WHERE "avatar" IN (
  'robot', 'astronaut', 'cat', 'fox', 'ghost', 'alien',
  'ninja', 'panda', 'bear', 'owl', 'frog', 'penguin'
);

-- Replace only the retired bundled preset ids. Unknown values are intentionally
-- left untouched so this migration cannot delete or rewrite user-owned uploads.
UPDATE "profiles"
SET "avatar" = 'flux-orbit'
WHERE "avatar" IN (
  '13350-aristocatlove',
  '1545-1000031285',
  '1612-mareo',
  '1734-vaultboy',
  '1826-pipboy',
  '1826-tecreo',
  '2408_gross_boy',
  '27221-arielfacepalm',
  '2902-hola',
  '3031-princess',
  '3139-vaultboyholdup',
  '34928-suspicious',
  '36063-okay',
  '36305-arielsteam',
  '3718-muerto',
  '3718-nukacola',
  '38741-shades',
  '391926-frog',
  '39738-funkymothman',
  '40335-shrug',
  '421918-cat',
  '422848-bunny',
  '4299-sabiondo',
  '4299-santoperonotanto',
  '46615-goofy',
  '4912-triste',
  '5002-fallout',
  '50074-bambigrimace',
  '532883-cash',
  '53848-aristocattongue',
  '54371-arielwhat',
  '5558-misterio',
  '55902-trophy',
  '5623-postolero',
  '5703-cuchillo',
  '58272-regret',
  '60413-argue',
  '605187-goat',
  '618492-diamond',
  '62157-sebhuh',
  '647772-pouch',
  '6844-fiesta',
  '69470-think',
  '71980-ariellove',
  '72467-tears',
  '72568-hesitant',
  '7285-fachero',
  '73697-scared',
  '74336-aristocathappy',
  '74926-aristocatmad',
  '75618-sebshock',
  '77535-aristocatwhat',
  '78677-arielhi',
  '7868-owo',
  '7938-shy',
  '79627-innocent',
  '7968_fallout_pip_boy',
  '79732-quantum-queers-logo',
  '79985-aristocathi',
  '80808-nervous',
  '809351-crown',
  '8364_fallout_ok',
  '84145-plead',
  '87893-laugh',
  '8871-chapa',
  '90370-arielsad',
  '9137-gasp',
  '91810-blank',
  '92984-thumbsup',
  '9368-enojo',
  '96311-dog',
  '9644-sad',
  '96763-beg',
  '97162-aristocatno',
  'tribal'
);
