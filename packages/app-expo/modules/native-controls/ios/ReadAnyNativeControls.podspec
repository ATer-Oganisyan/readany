Pod::Spec.new do |s|
  s.name           = 'ReadAnyNativeControls'
  s.version        = '0.1.0'
  s.summary        = 'Native UIKit controls for ReadAny'
  s.description    = 'Native UIKit controls with system menus and SF Symbols.'
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'ReadAny'
  s.homepage       = 'https://github.com/tuntuntutu/ReadAny'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.source_files   = '**/*.{h,m,swift}'
  s.frameworks     = 'UIKit'
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
