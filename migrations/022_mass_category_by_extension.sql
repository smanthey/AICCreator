-- Migration 022: Mass extension-based category tagging
-- ─────────────────────────────────────────────────────────────────────────────
-- No AI needed. File extension alone correctly categorizes 80%+ of all files.
-- The 'files' table stores filename (e.g. "video.mp4") but has no separate
-- ext column, so we extract it inline: SUBSTRING(filename FROM '[^.]+$')
--
-- Only fills WHERE category IS NULL — never overwrites existing classifications.

UPDATE files
SET
  category = CASE
    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'mp4','mov','avi','mkv','wmv','m4v','webm','mts','m2ts','vob',
      'flv','3gp','ogv','ts','mpg','mpeg','divx','xvid','rmvb','asf'
    ) THEN 'video'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'mp3','wav','aiff','aif','flac','m4a','aac','ogg','opus','wma',
      'caf','mid','midi','ra','amr','ape','wv','mka','m4b','m4r'
    ) THEN 'audio'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'jpg','jpeg','png','gif','heic','heif','tiff','tif','bmp','webp',
      'raw','cr2','cr3','nef','arw','orf','sr2','dng','rw2','pef','raf',
      'x3f','mrw','erf','kdc','dcr','nrw'
    ) THEN 'photo'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'psd','psb','ai','indd','indb','idml','xd','sketch','fig',
      'afdesign','afphoto','afpub','procreate','cdr','eps'
    ) THEN 'design'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'blend','fbx','obj','c4d','ma','mb','max','3ds','dae','ztl',
      'zpr','abc','usd','usda','usdc','usdz','glb','gltf','stl','ply',
      'skp','lwo','lxo','x3d','stp','step','iges','igs','zbrush'
    ) THEN '3d_asset'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'ipa','xcodeproj','xcworkspace','storyboard','xib','pbxproj',
      'xcscheme','xcsettings','xcconfig','nib'
    ) THEN 'ios_app'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'app','dmg','pkg','mpkg','sparklefeed'
    ) THEN 'mac_app'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'js','mjs','cjs','jsx','ts','tsx','coffee',
      'py','pyc','pyw','ipynb','rb','gem','rake','go','rs',
      'java','class','jar','php',
      'sh','bash','zsh','fish','ksh','csh',
      'swift','kt','kts','dart','lua',
      'r','rmd','scala','sbt','cs','csx',
      'cpp','cc','cxx','c','h','hh','hpp',
      'ex','exs','erl','hrl','clj','cljs',
      'hs','lhs','pl','pm','vb','vbs',
      'ps1','psm1','psd1','bat','cmd','asm','s','sol'
    ) THEN 'code'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'html','htm','css','scss','sass','less','vue','svelte'
    ) THEN 'web'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'pdf','doc','docx','xls','xlsx','xlsm','xltx','xlt',
      'ppt','pptx','pps','ppsx','pot','potx',
      'pages','numbers','keynote',
      'odt','ods','odp','odg','ott',
      'rtf','txt','md','mdx','rst','org','tex',
      'epub','mobi','azw','azw3','djvu'
    ) THEN 'document'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'csv','tsv','json','jsonl','geojson','yaml','yml','toml','ini',
      'cfg','conf','env','properties','xml','graphql','gql',
      'sql','db','sqlite','sqlite3','mdb','accdb'
    ) THEN 'data'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'ttf','otf','woff','woff2','eot','pfb','pfm','afm'
    ) THEN 'font'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'zip','tar','gz','bz2','xz','7z','rar','tgz','tbz','lz4',
      'zst','cab','iso','img','toast','vhd','vmdk'
    ) THEN 'archive'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'svg','ico','cur','icns','tga','pcx','pict'
    ) THEN 'image_other'

    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'bak','tmp','temp','swp','swo','log','lock','pid','cache',
      'pyc','pyo','o','a','so','dylib','map'
    ) OR filename IN ('.DS_Store','Thumbs.db','desktop.ini','.localized')
    THEN 'cache'

    ELSE 'unknown'
  END,

  category_confidence = CASE
    WHEN LOWER(SUBSTRING(filename FROM '[^.]+$')) IN (
      'mp4','mov','avi','mkv','mp3','wav','jpg','jpeg','png','heic',
      'psd','ai','blend','fbx','ipa','pdf','docx','xlsx','zip','ttf','svg'
    ) THEN 1.0
    ELSE 0.85
  END,

  category_reason = 'ext:' || LOWER(SUBSTRING(filename FROM '[^.]+$'))

WHERE category IS NULL
  AND filename LIKE '%.%';

-- Catch extensionless dot-files (cache/junk)
UPDATE files
SET
  category            = 'cache',
  category_confidence = 0.9,
  category_reason     = 'filename_pattern'
WHERE category IS NULL
  AND (
    filename IN ('.DS_Store','Thumbs.db','desktop.ini','.localized',
                 '.gitkeep','.gitignore','.npmignore','.dockerignore')
    OR (filename LIKE '.%' AND filename NOT LIKE '%.%')
  );
