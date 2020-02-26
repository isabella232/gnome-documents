pdfunite = find_program('pdfunite')
inkscape = find_program('inkscape')

sources = [
  'landing',
  'goa',
  'bookmarking',
  'scrubbing',
  'editing',
  'learn-more'
]

linguas = ['C']

output = 'gnome-documents-getting-started.pdf'

foreach lingua: linguas
  files = []
  foreach source: sources
    files += custom_target(
      source,
      input: join_paths(lingua, source + '.svg'),
      output: source + '.pdf',
      command: [inkscape, '--export-filename', '@OUTPUT@', '@INPUT@']
    )
  endforeach

  custom_target(
    output,
    input: files,
    output: output,
    command: [pdfunite, '@INPUT@', '@OUTPUT@'],
    install: true,
    install_dir: join_paths(documents_pkgdatadir, 'getting-started', lingua)
  )
endforeach
