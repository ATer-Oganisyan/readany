Pod::Spec.new do |s|
  s.name           = 'MorphSheetTransition'
  s.version        = '0.1.0'
  s.summary        = 'Native iOS zoom transition from a source view into a sheet'
  s.description    = 'Connects a React Native source view to an RNScreens destination using the iOS 18 zoom transition.'
  s.license        = 'GPL-3.0-or-later'
  s.author         = 'Narra'
  s.homepage       = 'https://github.com/tuntuntutu/ReadAny'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'RNScreens'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
