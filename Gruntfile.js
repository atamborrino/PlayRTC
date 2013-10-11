module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    uglify: {
      options: {
	      banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
      },
      build: {
	      src: '<%= pkg.name %>.js',
	      dest: '<%= pkg.name %>.min.js'
      }
    },

    copy: {
      main: {
      	files: [
      	  {src: ['playrtc.js'], dest: 'example/public/javascripts/'},
      	  {src: ['playrtc.min.js'], dest: 'example/public/javascripts/'}
      	]
      }
    }
    
  });

  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');

  // Default task(s).
  grunt.registerTask('default', ['uglify', 'copy']);

};
