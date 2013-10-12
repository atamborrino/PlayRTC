module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    uglify: {
      options: {
        banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
      },
      build: {
        src: 'client/<%= pkg.name %>.js',
        dest: 'client/<%= pkg.name %>.min.js'
      }
    },

    copy: {
      main: {
        files: [
          {src: ['client/playrtc.js'], dest: 'example/public/javascripts/'},
          {src: ['client/playrtc.min.js'], dest: 'example/public/javascripts/'}
        ]
      }
    }
    
  });

  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');

  // Default task(s).
  grunt.registerTask('default', ['uglify', 'copy']);

};
